// Virtual scrolling over a server collection (after the Jiro example in vantage-ui-examples):
// the virtualiser decides which rows are on screen, and one fixed-size window of the
// collection follows it. Only on-screen rows exist in the page, so 5000 flags scroll smoothly.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { CollectionWindow, LazyCollection } from "@vantage-ui/client";
import { useWindow } from "@vantage-ui/client/react";

/**
 * The window holds three screens of rows and moves a screen at a time. Its size is fixed for
 * the page's life: a new size would be a new subscription.
 */
function windowSize(rowHeight: number) {
  const screen = Math.max(10, Math.ceil(globalThis.innerHeight / rowHeight));
  return { size: screen * 3, step: screen };
}

/**
 * The virtual list's length: the window's `length`, except that with no server total a full
 * window adds a screen, so scrolling can reach the rows past it.
 */
function lengthOf<T>(page: CollectionWindow<T>, step: number) {
  const full = page.total === null && !page.lengthExact && page.length === page.start + page.count;
  return full ? page.length + step : page.length;
}

type Shown<T> = { collection: LazyCollection<T>; page: CollectionWindow<T>; length: number };

export function useServerWindow<T>(collection: LazyCollection<T>, rowHeight: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [{ size, step }] = useState(() => windowSize(rowHeight));
  const [headHeight, setHeadHeight] = useState(0);
  useLayoutEffect(() => {
    setHeadHeight(scrollRef.current?.querySelector("thead")?.getBoundingClientRect().height ?? 0);
  }, []);

  // What the table shows. After a search or sort change it stays on the previous rows until
  // the new collection has some, so the list doesn't blank.
  const shown = useRef<Shown<T> | null>(null);
  // The virtualiser sizes itself from the previous render's length; a change re-renders, so it
  // settles on the window it asked for.
  const [length, setLength] = useState(0);

  const virtualizer = useVirtualizer({
    count: length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    scrollMargin: headHeight,
    overscan: 10,
  });
  const visible = virtualizer.getVirtualItems();
  const first = visible[0]?.index ?? 0;
  const start = Math.floor(first / step) * step;
  const page = useWindow(collection, start, size);
  const hasRows = page.at(page.start) !== undefined;

  const current: Shown<T> = { collection, page, length: lengthOf(page, step) };
  const switching = shown.current !== null && shown.current.collection !== collection;
  if (!switching || page.settled || hasRows) shown.current = current;
  const display = shown.current ?? current;
  useEffect(() => { setLength(display.length); }, [display.length]);

  const last = visible[visible.length - 1];
  return {
    scrollRef,
    /** Back to the top, e.g. after the search or sort changed. */
    scrollToTop: () => scrollRef.current?.scrollTo({ top: 0 }),
    visible,
    rowAt: (index: number) => display.page.at(index),
    total: display.length,
    /** Whether `total` is the real count, or only as far as rows have arrived. */
    exact: display.page.lengthExact,
    loading: display === current && !page.settled && !hasRows,
    error: page.error,
    padTop: visible[0] ? visible[0].start - headHeight : 0,
    padBottom: last ? virtualizer.getTotalSize() - (last.end - headHeight) : 0,
  };
}
