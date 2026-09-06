// widget.tsx — CMHK 用量小组件（systemSmall / systemMedium）
// 现代化视觉：深色渐变卡片 + 渐变流量环。
// 数据策略：优先读缓存；缓存超过 30 分钟且有会话时，先做一次轻量刷新再渲染。
// 注意：Widget.present() 之后执行上下文立即销毁，所有数据必须在此之前准备好。

import {
  Button,
  Circle,
  HStack,
  Image,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
} from "scripting"
import {
  dataRemainingRatio,
  daysUntilBillDay,
  fmtGB,
  fmtMin,
  fmtMoney,
  fmtUpdatedAt,
  readCache,
  UsageData,
} from "./cmhk"
import { ringStops, theme } from "./theme"
import { RefreshIntent } from "./app_intents"

// ---------- 部件 ----------

function DataRing({ data, size }: { data: UsageData; size: number }) {
  const ratio = dataRemainingRatio(data)
  const stops = ringStops(ratio ?? 1)
  const lineWidth = Math.max(7, Math.round(size * 0.09))

  return (
    <ZStack frame={{ width: size, height: size }}>
      <Circle
        stroke={{
          shapeStyle: theme.ringTrack,
          strokeStyle: { lineWidth, lineCap: "round" },
        }}
      />
      {ratio != null && (
        <Circle
          trim={{ from: 0, to: ratio }}
          stroke={{
            shapeStyle: {
              gradient: [...stops],
              startPoint: { x: 0.5, y: 0 },
              endPoint: { x: 0.5, y: 1 },
            },
            strokeStyle: { lineWidth, lineCap: "round" },
          }}
          rotationEffect={-90}
        />
      )}
      <VStack spacing={0}>
        <Text font="title3" fontWeight="bold" foregroundStyle={theme.textPrimary}>
          {ratio != null ? `${Math.round(ratio * 100)}%` : "--"}
        </Text>
        <Text font="caption2" foregroundStyle={theme.textTertiary}>
          流量剩余
        </Text>
      </VStack>
    </ZStack>
  )
}

function StatRow({ icon, label, value, unit }: {
  icon: string
  label: string
  value: string
  unit?: string
}) {
  return (
    <HStack spacing={6}>
      <Image systemName={icon} foregroundStyle={theme.accent} frame={{ width: 14, height: 14 }} />
      <Text font="caption" foregroundStyle={theme.textTertiary}>{label}</Text>
      <Spacer />
      <HStack spacing={2} alignment="lastTextBaseline">
        <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary}>
          {value}
        </Text>
        {unit && (
          <Text font="caption2" foregroundStyle={theme.textTertiary}>{unit}</Text>
        )}
      </HStack>
    </HStack>
  )
}

function UpdatedFooter({ data, compact }: { data: UsageData; compact: boolean }) {
  return (
    <HStack spacing={4}>
      {data.stale && (
        <Image systemName="exclamationmark.triangle" foregroundStyle="#FFD66E" frame={{ width: 9, height: 9 }} />
      )}
      <Text font="caption2" foregroundStyle={theme.textTertiary}>
        更新于 {fmtUpdatedAt(data.fetchedAt)}
      </Text>
      <Spacer />
      {!compact && (
        <Button intent={RefreshIntent(undefined)}>
          <Image systemName="arrow.clockwise" foregroundStyle={theme.textSecondary} frame={{ width: 12, height: 12 }} />
        </Button>
      )}
    </HStack>
  )
}

// 费用文案：上台账户显示应缴金额；储值卡显示余额
function feeText(data: UsageData): { label: string; value: string } {
  if (data.billAmountHKD != null) return { label: "应缴金额", value: fmtMoney(data.billAmountHKD) }
  if (data.balanceHKD != null) return { label: "话费余额", value: fmtMoney(data.balanceHKD) }
  return { label: "话费", value: "--" }
}

function voiceText(data: UsageData): string {
  if (data.voiceUnlimited) return "无限"
  return fmtMin(data.voiceRemainingMin)
}

function roamText(data: UsageData): string | null {
  if (data.roamDataRemainingGB == null) return null
  const exp = data.roamExpiry ? ` · ${data.roamExpiry.slice(5).replace("-", "/")}止` : ""
  return `${fmtGB(data.roamDataRemainingGB)} GB${exp}`
}

function billDayText(data: UsageData): { value: string; unit: string } {
  const days = daysUntilBillDay(data)
  if (days != null) return { value: String(days), unit: "天后结算" }
  if (data.billDay != null) return { value: `每月${data.billDay}日`, unit: "" }
  return { value: "--", unit: "" }
}

// ---------- 小组件主体 ----------

function SmallWidget({ data }: { data: UsageData }) {
  const fee = feeText(data)
  const bill = billDayText(data)
  return (
    <VStack spacing={8} padding={12} background={theme.cardBackground as any}>
      <HStack spacing={4}>
        <Image systemName="antenna.radiowaves.left.and.right" foregroundStyle={theme.accentGreen} frame={{ width: 12, height: 12 }} />
        <Text font="caption2" fontWeight="medium" foregroundStyle={theme.textSecondary}>
          CMHK {data.accountNumber ?? data.phoneNumber ?? ""}
        </Text>
      </HStack>
      <Spacer />
      <HStack>
        <Spacer />
        <DataRing data={data} size={86} />
        <Spacer />
      </HStack>
      <Spacer />
      <HStack alignment="lastTextBaseline" spacing={3}>
        <Text font="headline" fontWeight="bold" foregroundStyle={theme.textPrimary}>
          {fee.value}
        </Text>
        <Text font="caption2" foregroundStyle={theme.textTertiary}>HK$ {fee.label}</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle={theme.textSecondary}>{bill.value}</Text>
      </HStack>
      <UpdatedFooter data={data} compact />
    </VStack>
  )
}

function MediumWidget({ data }: { data: UsageData }) {
  const fee = feeText(data)
  const roam = roamText(data)
  return (
    <HStack spacing={14} padding={14} background={theme.cardBackground as any}>
      {/* 左：流量环 */}
      <VStack spacing={4} alignment="center">
        <DataRing data={data} size={96} />
        <Text font="caption2" foregroundStyle={theme.textSecondary}>
          剩余 {fmtGB(data.dataRemainingGB)} / {fmtGB(data.dataTotalGB)} GB
        </Text>
      </VStack>
      {/* 右：关键数据 */}
      <VStack spacing={6} frame={{ maxWidth: "infinity" } as any}>
        <HStack spacing={4}>
          <Text font="caption" fontWeight="semibold" foregroundStyle={theme.textPrimary}>
            {data.planName ?? "CMHK 中国移动香港"}
          </Text>
          <Spacer />
        </HStack>
        <StatRow icon="creditcard" label={fee.label} value={fee.value} unit="HK$" />
        <StatRow icon="phone" label="通话剩余" value={voiceText(data)} unit={data.voiceUnlimited ? "" : "分钟"} />
        {roam && <StatRow icon="airplane" label="漫游数据" value={roam} unit="" />}
        <Spacer />
        <UpdatedFooter data={data} compact={false} />
      </VStack>
    </HStack>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <VStack spacing={8} padding={16} background={theme.cardBackground as any} alignment="center">
      <Spacer />
      <Image systemName="antenna.radiowaves.left.and.right.slash" foregroundStyle={theme.textTertiary} frame={{ width: 28, height: 28 }} />
      <Text font="caption" foregroundStyle={theme.textSecondary} multilineTextAlignment="center">
        {message}
      </Text>
      <Spacer />
    </VStack>
  )
}

// ---------- 入口 ----------

async function run() {
  // 小组件只读缓存：渲染进程有 ~30MB 内存上限，网页刷新（无头 WebView）
  // 放在 App 内打开 / 刷新按钮（AppIntent）里执行，不做在 widget 进程里。
  const data = readCache()

  if (!data) {
    Widget.present(<EmptyState message={"请先打开 App 内的\n「CMHK Usage」完成登录"} />, {
      reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
    })
    return
  }

  const family = Widget.family
  const view = family === "systemMedium" || family === "medium"
    ? <MediumWidget data={data} />
    : <SmallWidget data={data} />

  // 30 分钟后让系统重新取时间线
  Widget.present(view, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 30 * 60 * 1000) },
  })
}

run()
