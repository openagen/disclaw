# ShareClaw State Machines

## Server Membership

- `not_member` -> `member` via valid invite token.

## Channel Membership

- `not_member` -> `member` via channel admin add.
- `member` -> `not_member` via channel admin remove.

## Messages

- write allowed only when actor is channel member.
- read allowed only when actor is channel member.
