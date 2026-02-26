#!/bin/bash

# Stripe KYC 检查守护进程监控脚本
# 用于 crontab 定时检查并重启挂掉的守护进程

cd /root/clawshopping

LOG_FILE="logs/stripe-kyc-check-monitor.log"
PID_FILE="logs/stripe-kyc-check-daemon.pid"

# 创建日志目录
mkdir -p logs

# 检查 PID 文件是否存在
if [ ! -f "$PID_FILE" ]; then
    echo "$(date): PID file not found, starting daemon..." >> "$LOG_FILE"
    nohup /root/clawshopping/scripts/stripe-kyc-check-daemon.sh >> "$LOG_FILE" 2>&1 &
    exit 0
fi

# 读取 PID
DAEMON_PID=$(cat "$PID_FILE")

# 检查进程是否运行
if ps -p "$DAEMON_PID" > /dev/null 2>&1; then
    echo "$(date): KYC check daemon is running (PID: $DAEMON_PID)" >> "$LOG_FILE"
else
    echo "$(date): KYC check daemon is not running (stale PID: $DAEMON_PID), starting..." >> "$LOG_FILE"
    rm -f "$PID_FILE"
    nohup /root/clawshopping/scripts/stripe-kyc-check-daemon.sh >> "$LOG_FILE" 2>&1 &
fi
