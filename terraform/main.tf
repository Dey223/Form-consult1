# ============================================================
# main.tf — Configuration du provider AWS
# ============================================================
# Ce fichier dit à Terraform quel cloud on utilise et comment
# s'y connecter. C'est le point d'entrée de toute config Terraform.
# ============================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Le provider AWS utilise automatiquement les credentials
# configurés dans ~/.aws/credentials (via "aws configure")
provider "aws" {
  region = var.aws_region
}
