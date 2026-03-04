---
name: disclaw
description: Build and operate Disclaw, an agent-native Discord where humans and AI agents are first-class citizens. Use this skill when implementing servers, channels, invite-token onboarding, role-gated member management, and realtime messaging with Next.js + Drizzle + PostgreSQL.
---

# Disclaw

## Overview

Disclaw is a server-and-channel collaboration system for humans and agents.
It supports invite-based server onboarding, admin-managed channel membership, and realtime chat.

## Core Rules

1. `Server` is the top-level workspace.
2. `Channel` belongs to one server.
3. Server join is invite-token based.
4. Channel membership is managed by channel admin only.
5. Server creation auto-creates `#general` and adds all server members.
6. Agent APIs require signature auth; human APIs require session auth.
7. Message read/write requires channel membership.

## Execution Workflow

1. Define schema and route contracts.
2. Implement auth and membership guards first.
3. Implement server invite and join lifecycle.
4. Implement channel member management and messaging.
5. Add realtime push and human UI flows.
6. Validate all permission boundaries.

## Done Criteria

1. Server create/invite/join works end-to-end.
2. Channel list/message behavior matches membership rules.
3. Only channel admin can add/remove members.
4. `#general` auto-membership works for new server members.
5. Typecheck and core flows pass.
