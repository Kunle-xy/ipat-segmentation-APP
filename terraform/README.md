# IPAT Terraform Configuration

This directory contains Terraform configuration for provisioning GCP resources for the IPAT segmentation applications.

## Resources Managed

1. **BigQuery Dataset** - For storing distress data and analysis results
2. **Service Account** (optional) - For application authentication
3. **Cloud Storage Bucket** (optional) - For data backups
4. **Cloud Run Service** (optional) - For deploying the backend API

## Prerequisites

1. Install Terraform (>= 1.0)
2. GCP Project with billing enabled
3. Service account credentials file

## Setup

### 1. Initialize Terraform

```bash
cd terraform
terraform init
```

### 2. Create terraform.tfvars

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:
- `project_id`: Your GCP project ID
- `region`: GCP region (default: US for BigQuery)
- `dataset_id`: BigQuery dataset name
- `credentials_file`: Path to service account JSON file
- `service_account_email`: Service account email

### 3. Plan Infrastructure

```bash
terraform plan
```

Review the planned changes carefully.

### 4. Apply Configuration

```bash
terraform apply
```

Type `yes` when prompted to create the resources.

## Configuration Options

### Using Existing Service Account (Recommended)

Set in `terraform.tfvars`:
```hcl
create_service_account = false
service_account_email  = "your-service-account@project.iam.gserviceaccount.com"
```

### Creating New Service Account

Set in `terraform.tfvars`:
```hcl
create_service_account = true
```

### Enable Backup Bucket

Set in `terraform.tfvars`:
```hcl
create_backup_bucket = true
```

### Deploy to Cloud Run

Set in `terraform.tfvars`:
```hcl
deploy_cloud_run = true
backend_image    = "gcr.io/your-project/ipat-backend:latest"
```

## Outputs

After applying, Terraform will output:
- `dataset_id`: BigQuery dataset ID
- `dataset_location`: Dataset location
- `service_account_email`: Service account email
- `backup_bucket_name`: Backup bucket name (if created)
- `cloud_run_url`: Cloud Run service URL (if deployed)

View outputs anytime:
```bash
terraform output
```

## Managing Infrastructure

### View Current State

```bash
terraform show
```

### Update Resources

1. Modify `terraform.tfvars` or `*.tf` files
2. Run `terraform plan` to preview changes
3. Run `terraform apply` to apply changes

### Destroy Resources

**WARNING**: This will delete all resources including data!

```bash
terraform destroy
```

## State Management

Terraform state is stored locally in `terraform.tfstate`. For production:

1. Use remote state backend (GCS):

```hcl
terraform {
  backend "gcs" {
    bucket = "your-terraform-state-bucket"
    prefix = "ipat/state"
  }
}
```

2. Enable state locking
3. Restrict access to state files

## Cost Estimation

- **BigQuery Dataset**: Free (pay for queries and storage)
- **Cloud Storage**: ~$0.02/GB/month
- **Cloud Run**: Pay per request and compute time

Estimate: < $10/month for light usage

## Security Best Practices

1. **Never commit credentials**:
   - Add `*.tfvars` to `.gitignore` (except `.example` files)
   - Use encrypted state backend
   - Rotate service account keys regularly

2. **Least Privilege**:
   - Grant minimum required permissions
   - Use separate service accounts per environment

3. **Enable Audit Logs**:
   - Monitor BigQuery access
   - Review IAM changes

## Troubleshooting

### Error: Dataset already exists

If dataset was manually created:
```bash
terraform import google_bigquery_dataset.ipat_dataset projects/PROJECT_ID/datasets/DATASET_ID
```

### Error: Permission denied

Ensure service account has required roles:
- `roles/bigquery.admin`
- `roles/storage.admin` (if using backup bucket)
- `roles/run.admin` (if using Cloud Run)

### State Drift

If manual changes were made:
```bash
terraform refresh
terraform plan
```

## Additional Resources

- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [BigQuery Documentation](https://cloud.google.com/bigquery/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
