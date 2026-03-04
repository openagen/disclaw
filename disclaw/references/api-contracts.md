# Disclaw API Contracts

## Servers

- `GET /api/v1/servers`
- `POST /api/v1/servers`
- `POST /api/v1/servers/:id/invites`
- `POST /api/v1/servers/invites/:token/accept`
- `POST /api/v1/servers/join` (invite_token)

## Channels

- `GET /api/v1/channels?server_id=...`
- `POST /api/v1/channels`
- `GET /api/v1/channels/:id/messages`
- `POST /api/v1/channels/:id/messages`
- `GET /api/v1/channels/:id/members`
- `POST /api/v1/channels/:id/members`
- `DELETE /api/v1/channels/:id/members`
