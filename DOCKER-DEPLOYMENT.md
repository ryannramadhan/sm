# Docker Deployment Guide - Story Mentions Bot

Complete guide for deploying the Story Mentions Bot using Docker.

## 📋 Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Domain name pointing to your server (storymention.wa-xpress.com)
- SSL certificates (Let's Encrypt)

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# 1. Clone or upload your application to server
cd /var/www/waxpress/waxpress2

# 2. Build and start containers
docker-compose up -d

# 3. Check status
docker-compose ps
docker-compose logs -f storymention
```

### Option 2: Docker Only (Without nginx container)

If you already have nginx running on host:

```bash
# 1. Build the image
docker build -t storymention-app .

# 2. Run container
docker run -d \
  --name storymention \
  --restart unless-stopped \
  -p 3980:3980 \
  -v $(pwd)/auth_info_baileys:/app/auth_info_baileys \
  -v $(pwd)/public/assets:/app/public/assets \
  -v $(pwd)/messages.json:/app/messages.json \
  storymention-app

# 3. Check logs
docker logs -f storymention
```

## 📁 File Structure

```
/var/www/waxpress/waxpress2/
├── Dockerfile                 # Container configuration
├── docker-compose.yml         # Multi-container orchestration
├── .dockerignore             # Files to exclude from image
├── nginx.docker.conf         # Nginx config for Docker
├── nginx.conf                # Nginx config for host (existing)
├── server.js                 # Application code
├── package.json
├── pnpm-lock.yaml
├── messages.json             # Configuration (mounted as volume)
├── auth_info_baileys/        # WhatsApp session (mounted as volume)
└── public/
    └── assets/               # Uploaded media (mounted as volume)
```

## 🔧 Configuration

### 1. SSL Certificates Setup

Place your SSL certificates in the `ssl/` directory:

```bash
# Create SSL directory
mkdir -p ssl

# Copy certificates (if using Let's Encrypt)
sudo cp /etc/letsencrypt/live/storymention.wa-xpress.com/fullchain.pem ssl/
sudo cp /etc/letsencrypt/live/storymention.wa-xpress.com/privkey.pem ssl/
sudo cp /etc/letsencrypt/live/storymention.wa-xpress.com/chain.pem ssl/
sudo chmod 644 ssl/*.pem
```

Or mount them directly in docker-compose.yml:

```yaml
volumes:
  - /etc/letsencrypt/live/storymention.wa-xpress.com:/etc/nginx/ssl:ro
```

### 2. Environment Variables (Optional)

Create `.env` file for custom configuration:

```env
NODE_ENV=production
PORT=3980
```

### 3. Nginx Configuration

**Using Docker Nginx (included in docker-compose):**
- Edit `nginx.docker.conf` for SSL paths and domain
- Ports 80 and 443 will be exposed by nginx container

**Using Host Nginx (with PM2 or standalone):**
- Keep existing `nginx.conf` 
- Remove nginx service from docker-compose.yml
- Proxy to `localhost:3980`

## 🐳 Docker Commands

### Build & Run

```bash
# Build image
docker-compose build

# Start services
docker-compose up -d

# Start specific service
docker-compose up -d storymention
```

### Management

```bash
# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f storymention

# Restart services
docker-compose restart

# Stop services
docker-compose stop

# Stop and remove containers
docker-compose down

# Stop and remove everything (including volumes)
docker-compose down -v
```

### Monitoring

```bash
# Check container status
docker-compose ps

# Check resource usage
docker stats storymention-app

# Execute command inside container
docker-compose exec storymention sh

# View application logs inside container
docker-compose exec storymention cat /app/logs/app.log
```

## 📊 Health Checks

The application includes built-in health checks:

```bash
# Check health via API
curl http://localhost:3980/api/test/status

# Check Docker health status
docker inspect --format='{{.State.Health.Status}}' storymention-app
```

## 🔄 Updates & Maintenance

### Update Application Code

```bash
# 1. Pull latest changes
git pull origin main

# 2. Rebuild and restart
docker-compose up -d --build

# 3. View logs to verify
docker-compose logs -f storymention
```

### Backup Session Data

```bash
# Backup WhatsApp session
tar -czf backup-session-$(date +%Y%m%d).tar.gz auth_info_baileys/

# Backup uploaded media
tar -czf backup-media-$(date +%Y%m%d).tar.gz public/assets/

# Backup configuration
cp messages.json messages.json.backup
```

### Restore Session Data

```bash
# Restore WhatsApp session
tar -xzf backup-session-20250118.tar.gz

# Restart container
docker-compose restart storymention
```

## 🌐 Deployment Options

### Option A: Docker Compose with Nginx Container

Use if you don't have existing nginx:

```bash
docker-compose up -d
```

Access: https://storymention.wa-xpress.com

### Option B: Docker App + Host Nginx

Use if you already have nginx on host:

1. Edit `docker-compose.yml`, remove nginx service:

```yaml
version: '3.8'
services:
  storymention:
    # ... keep only this service
```

2. Start only the app:

```bash
docker-compose up -d
```

3. Configure host nginx to proxy to `localhost:3980` (use existing `nginx.conf`)

### Option C: Docker App Only (No Compose)

```bash
docker run -d \
  --name storymention \
  --restart unless-stopped \
  -p 3980:3980 \
  -v $(pwd)/auth_info_baileys:/app/auth_info_baileys \
  -v $(pwd)/public/assets:/app/public/assets \
  -v $(pwd)/messages.json:/app/messages.json \
  storymention-app
```

## 🔥 Firewall Configuration

```bash
# Allow HTTP/HTTPS (if using Docker nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Or just expose app port (if using host nginx)
sudo ufw allow 3980/tcp
sudo ufw reload
```

## 🐛 Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs storymention

# Check if port is already in use
sudo netstat -tulpn | grep 3980

# Remove old containers
docker-compose down
docker-compose up -d
```

### WhatsApp connection issues

```bash
# Check if session files exist
ls -la auth_info_baileys/

# Clear session and restart
rm -rf auth_info_baileys/*
docker-compose restart storymention

# View real-time logs
docker-compose logs -f storymention
```

### Permission issues

```bash
# Fix permissions
sudo chown -R 1000:1000 auth_info_baileys/
sudo chown -R 1000:1000 public/assets/
docker-compose restart storymention
```

### Nginx SSL issues

```bash
# Verify SSL certificates exist
ls -la ssl/

# Test nginx configuration
docker-compose exec nginx nginx -t

# Reload nginx
docker-compose exec nginx nginx -s reload
```

### Can't access application

```bash
# Check if containers are running
docker-compose ps

# Check nginx logs
docker-compose logs nginx

# Check app logs
docker-compose logs storymention

# Test connectivity
curl http://localhost:3980/api/test/status
```

## 📝 Production Checklist

- [ ] Domain DNS configured
- [ ] SSL certificates installed
- [ ] Firewall rules configured
- [ ] Docker and Docker Compose installed
- [ ] Application files uploaded to server
- [ ] `docker-compose.yml` configured
- [ ] SSL paths in nginx.docker.conf updated
- [ ] Containers started: `docker-compose up -d`
- [ ] Health check passing: `docker inspect storymention-app`
- [ ] Application accessible: https://storymention.wa-xpress.com
- [ ] WhatsApp QR code appears in UI
- [ ] Test status mention sending works
- [ ] Backup strategy configured

## 🔒 Security Notes

1. **Never commit** `auth_info_baileys/` to git (contains session keys)
2. **Restrict access** to SSL certificate files (chmod 600)
3. **Use environment variables** for sensitive config
4. **Regular backups** of session data and messages.json
5. **Update base image** regularly: `docker-compose pull && docker-compose up -d`

## 📊 Monitoring

### View resource usage

```bash
docker stats storymention-app storymention-nginx
```

### Set up automatic restarts

Already configured in docker-compose.yml:
```yaml
restart: unless-stopped
```

### Log rotation

Docker handles log rotation by default. Configure in `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

## 🆘 Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Verify health: `docker inspect storymention-app`
3. Test connectivity: `curl localhost:3980/api/test/status`
4. Review this guide's troubleshooting section
