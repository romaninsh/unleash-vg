# Deploy identity and secrets for unleash-vg in the golf production project. The GitHub OIDC
# pool/provider already exist (golf-infra, owner-scoped to romaninsh); this module adds an
# unleash-vg deployer, the Secret Manager secrets both services read, and (second pass) public
# access to the two Cloud Run services the deploy workflows create.
# A module of vantage-terraform (`module "unleash_vg"` in its main.tf, which configures the
# google provider for the project); applied from there.
# Secrets are created empty; their values are added with `gcloud secrets versions add`.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
  }
}

locals {
  project_id     = "inlaid-agility-461020-e4"
  project_number = "129027965449"
  region         = "europe-west2"
  repository     = "romaninsh/unleash-vg"
  # The services' runtime identity, as pizza-1-shop's.
  runtime_account = "${local.project_number}-compute@developer.gserviceaccount.com"
  services        = ["unleash-vg-admin", "unleash-vg-sdk", "unleash-vg-bench"]
  secrets = {
    # admin (vantage-server): wss://<user>:<pass>@<host>/rpc?auth=database
    "unleash-vg-surreal-url" = "SurrealDB Cloud URL with the database user's credentials (admin)"
    # sdk (flag service): wss://<host>/rpc, user and password apart
    "unleash-vg-surreal-endpoint" = "SurrealDB Cloud endpoint (sdk)"
    "unleash-vg-surreal-user"     = "SurrealDB Cloud database user (sdk)"
    "unleash-vg-surreal-pass"     = "SurrealDB Cloud database password (sdk)"
    "unleash-vg-internal-token"   = "Bearer token of the sdk's /internal/features, read by the admin"
    "unleash-vg-web-tokens"       = "The admin's sign-in tokens file, from tests/sync_web_users.sh"
    "unleash-vg-bench-tokens"     = "The bench's SDK tokens, TESTBENCH_TOKENS JSON (testbench/server/config.ts)"
  }
}

# ── Deployer service account for GitHub Actions ──────────────────────────

resource "google_service_account" "github_unleash_vg" {
  account_id   = "github-unleash-vg"
  display_name = "GitHub Actions deployer for romaninsh/unleash-vg"
}

# Let the unleash-vg repository (and only it) impersonate the deployer through the existing
# `golf` workload identity pool.
resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.github_unleash_vg.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${local.project_number}/locations/global/workloadIdentityPools/golf/attribute.repository/${local.repository}"
}

# Push images to the shared repository only, not every repository in the project.
resource "google_artifact_registry_repository_iam_member" "writer" {
  project    = local.project_id
  location   = local.region
  repository = "cloud-run-source-deploy"
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.github_unleash_vg.member
}

# run.developer (not chtags' run.admin): the deploys don't set the invoker policy; public access
# is granted once below.
resource "google_project_iam_member" "run_developer" {
  project = local.project_id
  role    = "roles/run.developer"
  member  = google_service_account.github_unleash_vg.member
}

# Cloud Run deploys need actAs on the runtime service account.
resource "google_service_account_iam_member" "act_as_compute" {
  service_account_id = "projects/${local.project_id}/serviceAccounts/${local.runtime_account}"
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.github_unleash_vg.member
}

# ── Secrets (no versions here) ───────────────────────────────────────────

resource "google_secret_manager_secret" "secret" {
  for_each  = local.secrets
  secret_id = each.key
  labels    = { app = "unleash-vg" }
  annotations = {
    purpose = each.value
  }
  replication {
    user_managed {
      replicas {
        location = local.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_reads" {
  for_each  = google_secret_manager_secret.secret
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_account}"
}

# ── The three services, public ───────────────────────────────────────────
# Created here with Google's placeholder container so they can be made public before the first
# deploy. The deploy workflows own what runs (image, env, secrets, size): `template` is ignored
# after creation, so a re-apply never rolls a deploy back.

resource "google_cloud_run_v2_service" "service" {
  for_each = toset(local.services)
  name     = each.key
  location = local.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = local.runtime_account
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits = { cpu = "1", memory = "256Mi" }
        # CPU only while a request runs (the deploys' default too); always-on CPU needs ≥ 512Mi
        cpu_idle = true
      }
    }
  }

  lifecycle {
    ignore_changes = [template, client, client_version]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = google_cloud_run_v2_service.service
  project  = local.project_id
  location = local.region
  name     = each.value.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "deployer_email" {
  value = google_service_account.github_unleash_vg.email
}

output "workload_identity_provider" {
  value = "projects/${local.project_number}/locations/global/workloadIdentityPools/golf/providers/github"
}
