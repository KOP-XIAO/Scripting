// widget.tsx — CMHK 用量小组件（systemSmall / systemMedium）
// 流量桶展示：环=第一个流量桶（套餐内），行=其余流量桶（赠送/漫遊）+ 通话 + 代缴话费 + 会籍。
// 数据策略：小组件进程只读缓存（约30MB上限，联网刷新放 App/AppIntent）。

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
  fmtGB,
  fmtMin,
  fmtMoney,
  fmtUpdatedAt,
  readCache,
  UsageData,
} from "./cmhk"
import { ringStops, theme } from "./theme"
import { RefreshIntent } from "./app_intents"

type Bucket = { name: string; totalGB: number | null; remainingGB: number | null; expiry: string | null }

function bucketsOf(d: UsageData): Bucket[] {
  if (d.buckets && d.buckets.length) return d.buckets
  if (d.dataTotalGB != null)
    return [{ name: "套餐數據", totalGB: d.dataTotalGB, remainingGB: d.dataRemainingGB, expiry: null }]
  return []
}

function ratioOf(b?: Bucket | null): number | null {
  if (!b || b.totalGB == null || b.remainingGB == null || b.totalGB <= 0) return null
  return Math.max(0, Math.min(1, b.remainingGB / b.totalGB))
}

function DataRing({ bucket, size }: { bucket?: Bucket; size: number }) {
  const ratio = ratioOf(bucket)
  const stops = ringStops(ratio ?? 1)
  const lineWidth = Math.max(7, Math.round(size * 0.09))
  return (
    <ZStack frame={{ width: size, height: size }}>
      <Circle stroke={{ shapeStyle: theme.ringTrack, strokeStyle: { lineWidth, lineCap: "round" } }} />
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
        <Text font="caption2" foregroundStyle={theme.textTertiary}>流量剩余</Text>
      </VStack>
    </ZStack>
  )
}

function StatRow({ icon, label, value, unit }: { icon: string; label: string; value: string; unit?: string }) {
  return (
    <HStack spacing={6}>
      <Image systemName={icon} foregroundStyle={theme.accent} frame={{ width: 14, height: 14 }} />
      <Text font="caption" foregroundStyle={theme.textTertiary} lineLimit={1}>{label}</Text>
      <Spacer />
      <HStack spacing={2} alignment="lastTextBaseline">
        <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary}>
          {value}
        </Text>
        {unit && <Text font="caption2" foregroundStyle={theme.textTertiary}>{unit}</Text>}
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
      <Text font="caption2" foregroundStyle={theme.textTertiary}>更新于 {fmtUpdatedAt(data.fetchedAt)}</Text>
      <Spacer />
      {!compact && (
        <Button intent={RefreshIntent(undefined)}>
          <Image systemName="arrow.clockwise" foregroundStyle={theme.textSecondary} frame={{ width: 12, height: 12 }} />
        </Button>
      )}
    </HStack>
  )
}

// 后付款账户 → 代缴话费；储值卡 → 话费余额
function feeOf(d: UsageData): { label: string; value: string; show: boolean } {
  if (d.billAmountHKD != null) return { label: "代缴话费", value: fmtMoney(d.billAmountHKD), show: true }
  if (d.balanceHKD != null) return { label: "话费余额", value: fmtMoney(d.balanceHKD), show: true }
  return { label: "代缴话费", value: "--", show: false }
}

function voiceText(d: UsageData): string {
  if (d.voiceUnlimited) return "无限"
  return fmtMin(d.voiceRemainingMin)
}
function expiryShort(b?: Bucket): string {
  const e = b?.expiry
  return e ? e.slice(5).replace("-", "/") : ""
}
function shortName(n: string): string {
  if (n.length <= 14) return n
  return `${n.slice(0, 14)}…`
}

// ---------- 主体 ----------

function SmallWidget({ data }: { data: UsageData }) {
  const buckets = bucketsOf(data)
  const main = buckets[0]
  const fee = feeOf(data)
  const extra = buckets[1]
  return (
    <VStack spacing={6} padding={12} background={theme.cardBackground as any}>
      <HStack spacing={4}>
        <Image systemName="antenna.radiowaves.left.and.right" foregroundStyle={theme.accentGreen} frame={{ width: 12, height: 12 }} />
        <Text font="caption2" fontWeight="medium" foregroundStyle={theme.textSecondary} lineLimit={1}>
          {data.planName ? shortName(data.planName) : data.accountNumber ?? ""}
        </Text>
        {data.membershipTier && (
          <Image systemName="crown.fill" foregroundStyle="#FFD66E" frame={{ width: 10, height: 10 }} />
        )}
      </HStack>
      <Spacer />
      <HStack>
        <Spacer />
        <DataRing bucket={main} size={82} />
        <Spacer />
      </HStack>
      <Text font="caption2" foregroundStyle={theme.textSecondary} lineLimit={1}>
        {main ? `${main.name} · 剩 ${fmtGB(main.remainingGB)}/${fmtGB(main.totalGB)} GB` : "—"}
      </Text>
      <HStack alignment="lastTextBaseline" spacing={3}>
        <Text font="headline" fontWeight="bold" foregroundStyle={theme.textPrimary}>{fee.value}</Text>
        <Text font="caption2" foregroundStyle={theme.textTertiary}>HK$ {fee.label}</Text>
        <Spacer />
        {extra && (
          <Text font="caption2" foregroundStyle={theme.textSecondary} lineLimit={1}>
            {shortName(extra.name)} {fmtGB(extra.remainingGB)}
          </Text>
        )}
      </HStack>
      <UpdatedFooter data={data} compact />
    </VStack>
  )
}

function MediumWidget({ data }: { data: UsageData }) {
  const buckets = bucketsOf(data)
  const main = buckets[0]
  const extras = buckets.slice(1).slice(0, 2)
  const fee = feeOf(data)
  const membership = data.membershipTier || data.points != null
  return (
    <HStack spacing={14} padding={14} background={theme.cardBackground as any}>
      {/* 左：主流量环 */}
      <VStack spacing={4} alignment="center">
        <DataRing bucket={main} size={92} />
        <Text font="caption2" foregroundStyle={theme.textSecondary} lineLimit={1}>
          {main ? `剩 ${fmtGB(main.remainingGB)}/${fmtGB(main.totalGB)} GB` : "—"}
        </Text>
      </VStack>
      {/* 右：明细 */}
      <VStack spacing={5} frame={{ maxWidth: "infinity" } as any}>
        <Text font="caption" fontWeight="semibold" foregroundStyle={theme.textPrimary} lineLimit={1}>
          {shortName(data.planName ?? "CMHK")}
        </Text>
        <HStack spacing={6}>
          <Text font="caption2" foregroundStyle={theme.textTertiary} lineLimit={1}>
            {data.accountNumber ? `賬號 ${data.accountNumber}` : data.phoneNumber ?? ""}
          </Text>
          {membership && (
            <Text font="caption2" foregroundStyle="#FFD66E" lineLimit={1}>
              {data.membershipTier ?? ""}{data.points != null ? ` · ${data.points}分` : ""}
            </Text>
          )}
        </HStack>
        <StatRow icon="creditcard" label={fee.label} value={fee.value} unit="HK$" />
        <StatRow icon="phone" label="通话剩余" value={voiceText(data)} unit={data.voiceUnlimited ? "" : "分钟"} />
        {extras.map((b, i) => (
          <StatRow
            key={i}
            icon="arrow.down.circle"
            label={shortName(b.name)}
            value={`${fmtGB(b.remainingGB)} GB${expiryShort(b) ? ` · ${expiryShort(b)}止` : ""}`}
          />
        ))}
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
      <Text font="caption" foregroundStyle={theme.textSecondary} multilineTextAlignment="center">{message}</Text>
      <Spacer />
    </VStack>
  )
}

async function run() {
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
  Widget.present(view, {
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 30 * 60 * 1000) },
  })
}

run()
