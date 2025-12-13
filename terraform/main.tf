terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  credentials = file(var.credentials_file)
}

# BigQuery Dataset
resource "google_bigquery_dataset" "ipat_dataset" {
  dataset_id                 = var.dataset_id
  friendly_name              = "IPAT Distress Analysis Dataset"
  description                = "Dataset for storing IPAT pavement distress data and analysis results"
  location                   = var.region
  default_table_expiration_ms = null

  labels = {
    environment = var.environment
    project     = "ipat-analysis"
  }

  access {
    role          = "OWNER"
    user_by_email = var.service_account_email
  }

  access {
    role          = "OWNER"
    special_group = "projectOwners"
  }

  access {
    role          = "READER"
    special_group = "projectReaders"
  }

  access {
    role          = "WRITER"
    special_group = "projectWriters"
  }
}

# Service Account (if not using existing one)
resource "google_service_account" "ipat_service_account" {
  count        = var.create_service_account ? 1 : 0
  account_id   = "ipat-analysis-sa"
  display_name = "IPAT Analysis Service Account"
  description  = "Service account for IPAT pavement distress analysis application"
}

# IAM Policy for Service Account
resource "google_project_iam_member" "bigquery_admin" {
  count   = var.create_service_account ? 1 : 0
  project = var.project_id
  role    = "roles/bigquery.admin"
  member  = "serviceAccount:${google_service_account.ipat_service_account[0].email}"
}

resource "google_project_iam_member" "bigquery_data_editor" {
  count   = var.create_service_account ? 1 : 0
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.ipat_service_account[0].email}"
}

resource "google_project_iam_member" "bigquery_job_user" {
  count   = var.create_service_account ? 1 : 0
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.ipat_service_account[0].email}"
}

# Cloud Storage bucket for data backups (optional)
resource "google_storage_bucket" "ipat_backup" {
  count         = var.create_backup_bucket ? 1 : 0
  name          = "${var.project_id}-ipat-backup"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }

  versioning {
    enabled = true
  }

  labels = {
    environment = var.environment
    project     = "ipat-analysis"
  }
}

# IAM binding for bucket (if created)
resource "google_storage_bucket_iam_member" "backup_admin" {
  count  = var.create_backup_bucket && var.create_service_account ? 1 : 0
  bucket = google_storage_bucket.ipat_backup[0].name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.ipat_service_account[0].email}"
}

# Cloud Run service (optional - for deploying the backend)
resource "google_cloud_run_service" "ipat_backend" {
  count    = var.deploy_cloud_run ? 1 : 0
  name     = "ipat-backend"
  location = var.region

  template {
    spec {
      containers {
        image = var.backend_image

        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }

        env {
          name  = "GCP_DATASET_ID"
          value = var.dataset_id
        }

        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }

      service_account_name = var.create_service_account ? google_service_account.ipat_service_account[0].email : var.service_account_email
    }

    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "10"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

# Make Cloud Run service publicly accessible (if deployed)
resource "google_cloud_run_service_iam_member" "public_access" {
  count    = var.deploy_cloud_run ? 1 : 0
  service  = google_cloud_run_service.ipat_backend[0].name
  location = google_cloud_run_service.ipat_backend[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
