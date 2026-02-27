#!/bin/bash

# 商品审核守护进程
# 每60秒检查一次 pending_review 状态的商品并自动审核通过

cd /root/clawshopping

LOG_FILE="logs/asset-review-daemon.log"
PID_FILE="logs/asset-review-daemon.pid"

CHECK_INTERVAL=60

# 创建日志目录
mkdir -p logs

# 检查是否已经有守护进程在运行
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "$(date): Daemon is already running (PID: $OLD_PID)"
        exit 1
    else
        # 清理旧的 PID 文件
        rm -f "$PID_FILE"
    fi
fi

# 保存当前进程 PID
echo $$ > "$PID_FILE"

echo "$(date): Asset review daemon started" >> "$LOG_FILE"

# 清理函数
cleanup() {
    echo "$(date): Asset review daemon stopped" >> "$LOG_FILE"
    rm -f "$PID_FILE"
    exit 0
}

# 捕获退出信号
trap cleanup SIGTERM SIGINT

# 主循环
while true; do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    OUTPUT=$(node scripts/approve-asset.js 2>&1)
    echo "[$TIMESTAMP] $OUTPUT" >> "$LOG_FILE"

    sleep $CHECK_INTERVAL
done
