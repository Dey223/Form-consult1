# ============================================================
# ec2.tf — Serveur virtuel (instance EC2) sur AWS
# ============================================================
# EC2 (Elastic Compute Cloud) = un ordinateur virtuel dans le
# datacenter AWS. On va y déployer notre application Docker.
# ============================================================

# Récupère automatiquement la dernière image Amazon Linux 2023
# (le système d'exploitation qui sera installé sur notre serveur)
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

# Security Group = pare-feu virtuel
# Définit quels ports sont accessibles depuis internet
resource "aws_security_group" "formconsult_sg" {
  name        = "${var.project_name}-sg"
  description = "Pare-feu pour FormConsult"

  # Port 22 — SSH : pour se connecter au serveur en ligne de commande
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "SSH"
  }

  # Port 80 — HTTP : accès web standard
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP"
  }

  # Port 3000 — Next.js : notre application
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Application FormConsult"
  }

  # Trafic sortant : autoriser tout (pour télécharger Docker, npm, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Tout le trafic sortant autorise"
  }

  tags = {
    Name    = "${var.project_name}-sg"
    Project = var.project_name
  }
}

# L'instance EC2 : notre serveur virtuel
resource "aws_instance" "formconsult_server" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type  # t2.micro = Free Tier
  key_name      = var.key_name       # Clé SSH pour se connecter au serveur

  vpc_security_group_ids = [aws_security_group.formconsult_sg.id]

  # Script exécuté automatiquement au premier démarrage du serveur
  # Il installe Docker et Docker Compose
  user_data = <<-EOF
    #!/bin/bash
    yum update -y
    yum install -y docker
    systemctl start docker
    systemctl enable docker
    usermod -aG docker ec2-user
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
  EOF

  tags = {
    Name    = "${var.project_name}-server"
    Project = var.project_name
  }
}

# Affiche l'IP publique du serveur après création
output "server_public_ip" {
  description = "Adresse IP publique du serveur FormConsult"
  value       = aws_instance.formconsult_server.public_ip
}
