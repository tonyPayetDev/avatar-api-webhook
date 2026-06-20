# Avatar AI Video Generator Webhook

API webhook pour générer des vidéos avatar avec IA, Hyperframe et voice synthesis.

## Usage

```bash
curl -X POST https://avatar-api.automatisationboost.com/avatar/generate \
  -H "Content-Type: application/json" \
  -d '{
    "avatarUrl": "https://...",
    "voiceUrl": "https://...",
    "topic": "Your topic",
    "userEmail": "your@email.com"
  }'
```

## Response

```json
{
  "status": "success",
  "data": {
    "videoUrl": "https://...",
    "email": { "to": "...", "status": "sent" }
  }
}
```

## Endpoints

- `POST /avatar/generate` - Generate avatar video
- `GET /health` - Health check

## Author
Tony PAYET
