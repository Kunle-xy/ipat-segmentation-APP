variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "vernal-citadel-479904-i2"
}

variable "region" {
  description = "GCP Region for Cloud Run and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "bigquery_location" {
  description = "BigQuery dataset location (can be multi-region like US)"
  type        = string
  default     = "US"
}

variable "dataset_id" {
  description = "BigQuery Dataset ID"
  type        = string
  default     = "ipat_dataset"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "credentials_file" {
  description = "Path to GCP service account credentials file"
  type        = string
  default     = "../backend/gcp-service-account.json"
}

variable "service_account_email" {
  description = "Service account email"
  type        = string
  default     = "ipat-segmentation@vernal-citadel-479904-i2.iam.gserviceaccount.com"
}

variable "create_service_account" {
  description = "Whether to create a new service account"
  type        = bool
  default     = false
}

variable "create_backup_bucket" {
  description = "Whether to create a Cloud Storage bucket for backups"
  type        = bool
  default     = false
}

variable "deploy_cloud_run" {
  description = "Whether to deploy to Cloud Run"
  type        = bool
  default     = false
}

variable "backend_image" {
  description = "Docker image for the backend"
  type        = string
  default     = "us-central1-docker.pkg.dev/vernal-citadel-479904-i2/ipat/ipat-backend:latest"
}

variable "frontend_image" {
  description = "Docker image for the frontend"
  type        = string
  default     = "us-central1-docker.pkg.dev/vernal-citadel-479904-i2/ipat/ipat-frontend:latest"
}
