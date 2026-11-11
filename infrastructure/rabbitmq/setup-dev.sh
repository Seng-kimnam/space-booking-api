#!/bin/sh
# Idempotent dev setup for the shared Space Booking <-> LMS broker:
# one vhost, one user per system, least-privilege permissions
# (docs/integration/messaging-contract.md section 7).
#
# Run once after the container is up (from the repo root):
#   docker compose --env-file .env -f infrastructure/docker/development/docker-compose.yml \
#     exec rabbitmq sh /setup-dev.sh
#
# Dev passwords only. Staging/production: generated passwords, no `management` tag, TLS.
set -e

V=space-library-dev
rabbitmqctl add_vhost "$V" 2>/dev/null || true
rabbitmqctl add_user space-booking space-booking-dev 2>/dev/null || true
rabbitmqctl add_user library library-dev 2>/dev/null || true

# Every object a system owns starts with its name. Read on the other system's
# exchange is needed to bind a queue to it. Nobody can write to amq.default.
#                                       configure            write                read
rabbitmqctl set_permissions -p "$V" space-booking '^space-booking\..*' '^space-booking\..*' '^space-booking\..*|^library\.events$'
rabbitmqctl set_permissions -p "$V" library       '^library\..*'       '^library\..*'       '^library\..*|^space-booking\.events$'

# Dev only: each team can log in to the management UI as its own user.
rabbitmqctl set_user_tags space-booking management
rabbitmqctl set_user_tags library management

echo "RabbitMQ dev setup done: vhost $V, users space-booking / library"
