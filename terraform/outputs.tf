output "dataset_id" {
  description = "BigQuery Dataset ID"
  value       = google_bigquery_dataset.ipat_dataset.dataset_id
}

output "dataset_location" {
  description = "BigQuery Dataset Location"
  value       = google_bigquery_dataset.ipat_dataset.location
}

output "dataset_self_link" {
  description = "BigQuery Dataset Self Link"
  value       = google_bigquery_dataset.ipat_dataset.self_link
}

output "service_account_email" {
  description = "Service Account Email"
  value       = var.create_service_account ? google_service_account.ipat_service_account[0].email : var.service_account_email
}

output "backup_bucket_name" {
  description = "Cloud Storage Backup Bucket Name"
  value       = var.create_backup_bucket ? google_storage_bucket.ipat_backup[0].name : null
}

output "cloud_run_url" {
  description = "Cloud Run Service URL"
  value       = var.deploy_cloud_run ? google_cloud_run_service.ipat_backend[0].status[0].url : null
}

output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}
