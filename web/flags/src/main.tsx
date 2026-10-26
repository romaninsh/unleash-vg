import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createVantage } from "@vantage-ui/client";
import { VantageProvider } from "@vantage-ui/client/react";
import { schema, type Schema } from "./vantage.gen";
import { readToken } from "./auth";
import { Gate } from "./Gate";
import { App } from "./App";
import "./styles.css";

// One client for the page; it connects to /v1/ws on the origin that served it.
// The token is read on every connect, so signing in only needs a reconnect.
const db = createVantage<Schema>({ schema, token: readToken });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VantageProvider db={db} fallback={<Gate />}>
      <Gate>
        <App />
      </Gate>
    </VantageProvider>
  </StrictMode>,
);
