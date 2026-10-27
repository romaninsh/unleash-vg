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
  services       = ["unleash-vg-admin", "unleash-vg-sdk", "unleash-vg-bench"]
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

# unleash-vg's own provider in the existing `golf` pool (golf-infra's `github` provider admits any
# romaninsh repository and ref). It admits only unleash-vg's runs on main while main is a protected
# branch (the token's ref_protected claim), and stamps them with an attribute the shared provider
# never sets, so the deployer below can't be reached through it.
resource "google_iam_workload_identity_pool_provider" "main" {
  workload_identity_pool_id          = "golf"
  workload_identity_pool_provider_id = "unleash-vg-main"
  display_name                       = "unleash-vg, protected main"
  attribute_condition                = "assertion.repository == '${local.repository}' && assertion.ref == 'refs/heads/main' && string(assertion.ref_protected) == 'true'"
  attribute_mapping = {
    "google.subject"           = "assertion.sub"
    "attribute.repository"     = "assertion.repository"
    "attribute.unleash_deploy" = "'protected-main'"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.github_unleash_vg.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${local.project_number}/locations/global/workloadIdentityPools/golf/attribute.unleash_deploy/protected-main"
}

# unleash-vg's own image repository. Writing to the shared cloud-run-source-deploy would let the
# deployer replace other apps' images (chtags-api, golf-backend) and so run code as them.
resource "google_artifact_registry_repository" "images" {
  location      = local.region
  repository_id = "unleash-vg"
  description   = "unleash-vg's admin, sdk and bench images (the deploy workflows push here)"
  format        = "DOCKER"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-10-newest"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-the-rest"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days; the KEEP policy above wins for the 10 newest
    }
  }
}

resource "google_artifact_registry_repository_iam_member" "writer" {
  project    = local.project_id
  location   = local.region
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.github_unleash_vg.member
}

# What `gcloud run deploy` of a new revision to an existing service needs, and nothing else: no
# delete, no IAM policy changes, no jobs, no SSH (roles/run.developer has all of those).
resource "google_project_iam_custom_role" "deployer" {
  role_id     = "unleashVgDeployer"
  title       = "unleash-vg deployer"
  description = "Deploy a new revision to an existing unleash-vg Cloud Run service."
  permissions = [
    "run.services.get",
    "run.services.update",
    "run.revisions.get",
    "run.revisions.list",
    "run.configurations.get",
    "run.routes.get",
    "run.operations.get",
  ]
}

# Bound on the three unleash-vg services only, not the project's other services.
resource "google_cloud_run_v2_service_iam_member" "deployer" {
  for_each = google_cloud_run_v2_service.service
  project  = local.project_id
  location = local.region
  name     = each.value.name
  role     = google_project_iam_custom_role.deployer.id
  member   = google_service_account.github_unleash_vg.member
}

# ── Runtime identity ─────────────────────────────────────────────────────
# What the containers run as: it can read the unleash-vg secrets below and nothing else (not the
# project's default compute account, which holds Editor).

resource "google_service_account" "runtime" {
  account_id   = "unleash-vg-runtime"
  display_name = "unleash-vg's Cloud Run services (admin, sdk, bench)"
}

# Cloud Run deploys need actAs on the runtime service account.
resource "google_service_account_iam_member" "act_as_runtime" {
  service_account_id = google_service_account.runtime.name
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
  member    = google_service_account.runtime.member
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

  # ignore_changes keeps a service on the identity it was created with; the deploys pass
  # --service-account unleash-vg-runtime.
  template {
    service_account = google_service_account.runtime.email
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

output "runtime_email" {
  value = google_service_account.runtime.email
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.main.name
}
