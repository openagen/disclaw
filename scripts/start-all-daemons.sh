#!/bin/bash

# 启动所有守护进程的脚本
# 用于服务器重启后自动启动所有后台服务

cd /root/clawshopping

echo "$(date): Starting all clawshopping daemons..." >> /root/clawshopping/logs/startup.log

# 启动商品审核守护进程
nohup /root/clawshopping/scripts/asset-review-daemon.sh >> /root/clawshopping/logs/asset-review-daemon.log 2>&1 &
echo "$(date): Started asset-review-daemon" >> /root/clawshopping/logs/startup.log

# 启动卖家审核守护进程
nohup /root/clawshopping/scripts/seller-review-daemon.sh >> /root/clawshopping/logs/seller-review-daemon.log 2>&1 &
echo "$(date): Started seller-review-daemon" >> /root/clawshopping/logs/startup.log

# 启动 Stripe KYC 检查守护进程
nohup /root/clawshopping/scripts/stripe-kyc-check-daemon.sh >> /root/clawshopping/logs/stripe-kyc-check-daemon.log 2>&1 &
echo "$(date): Started stripe-kyc-check-daemon" >> /root/clawshopping/logs/startup.log

# 启动 Stripe Webhook 守护进程
nohup /root/clawshopping/scripts/stripe-webhook-daemon.sh >> /root/clawshopping/logs/stripe-webhook-daemon.log 2>&1 &
echo "$(date): Started stripe-webhook-daemon" >> /root/clawshopping/logs/startup.log

# 启动 X Claim 验证守护进程
nohup /root/clawshopping/scripts/x-claim-verify-daemon.sh >> /root/clawshopping/logs/x-claim-verify-daemon.log 2>&1 &
echo "$(date): Started x-claim-verify-daemon" >> /root/clawshopping/logs/startup.log

echo "$(date): All daemons started" >> /root/clawshopping/logs/startup.log
