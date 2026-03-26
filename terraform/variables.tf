# ============================================================
# variables.tf — Paramètres configurables de l'infrastructure
# ============================================================
# Centraliser les valeurs ici permet de changer la config
# sans toucher au reste des fichiers.
# ============================================================

variable "aws_region" {
  description = "Région AWS où déployer l'infrastructure"
  type        = string
  default     = "eu-west-3"  # Paris
}

variable "instance_type" {
  description = "Type d'instance EC2 (t3.micro = gratuit sur Free Tier, remplace t2.micro dans les nouvelles régions)"
  type        = string
  default     = "t3.micro"
}

variable "project_name" {
  description = "Nom du projet (utilisé pour nommer les ressources)"
  type        = string
  default     = "formconsult"
}

variable "key_name" {
  description = "Nom de la paire de clés SSH pour accéder au serveur EC2"
  type        = string
  default     = "formconsult-key"
}
