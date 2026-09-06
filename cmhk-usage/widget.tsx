// widget.tsx — CMHK 用量小组件（systemSmall / systemMedium）
// 精简排版：环=首个流量桶（套餐内），右侧最多 3 行（代缴话费/通话/其余流量桶），
// 标签用短名，值尽量不截断。小组件进程只读缓存，联网刷新在 App/AppIntent。

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
import { daysUntilCycleEnd, fmtGB, fmtMin, fmtMoney, fmtUpdatedAt, readCache, UsageData } from "./cmhk"
import { ringStops, theme } from "./theme"
import { RefreshIntent } from "./app_intents"

type Bucket = { name: string; totalGB: number | null; remainingGB: number | null; expiry: string | null }

function bucketsOf(d: UsageData): Bucket[] {
  if (d.buckets && d.buckets.length) return d.buckets
  if (d.dataTotalGB != null) return [{ name: "套餐數據", totalGB: d.dataTotalGB, remainingGB: d.dataRemainingGB, expiry: null }]
  return []
}
function ratioOf(b?: Bucket | null): number | null {
  if (!b || b.totalGB == null || b.remainingGB == null || b.totalGB <= 0) return null
  return Math.max(0, Math.min(1, b.remainingGB / b.totalGB))
}

// 分类→短标签
function shortPlan(s: string): string {
  // "5G一咭三地計劃60GB" → "5G一咭三地計劃"
  const m = s.match(/^(.+?計劃)\d+/)
  return (m ? m[1] : s).length > 16 ? `${(m ? m[1] : s).slice(0, 16)}…` : (m ? m[1] : s)
}
function shortLabel(s: string): string {
  if (/服務計劃|数据|數據/.test(s)) return "套餐内"
  if (/漫遊|漫游/.test(s)) return "漫游"
  if (/贈送|赠送|extra/i.test(s)) return "赠送"
  return s.length > 6 ? `${s.slice(0, 6)}` : s
}
function expiryShort(b?: Bucket): string {
  const e = b?.expiry
  return e ? e.slice(5).replace("-", "/") : ""
}

function DataRing({ bucket, size }: { bucket?: Bucket; size: number }) {
  const ratio = ratioOf(bucket)
  const stops = ringStops(ratio ?? 1)
  const lw = Math.max(7, Math.round(size * 0.09))
  return (
    <ZStack frame={{ width: size, height: size }}>
      <Circle stroke={{ shapeStyle: theme.ringTrack, strokeStyle: { lineWidth: lw, lineCap: "round" } }} />
      {ratio != null && (
        <Circle
          trim={{ from: 0, to: ratio }}
          stroke={{
            shapeStyle: { gradient: [...stops], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } },
            strokeStyle: { lineWidth: lw, lineCap: "round" },
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

function Row({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <HStack spacing={6}>
      <Image systemName={icon} foregroundStyle={color ?? theme.accent} frame={{ width: 11, height: 11 }} />
      <Text font="caption2" foregroundStyle={theme.textTertiary}>{label}</Text>
      <Spacer />
      <Text font="footnote" fontWeight="semibold" foregroundStyle={color ?? theme.textPrimary}>{value}</Text>
    </HStack>
  )
}

function FeeText({ d }: { d: UsageData }): { label: string; value: string; color: string } {
  if (d.billAmountHKD != null) {
    const owed = d.billAmountHKD < 0
    return { label: owed ? "欠费" : "代缴话费", value: `HK$ ${fmtMoney(Math.abs(d.billAmountHKD))}`, color: owed ? "#FF6B5E" : theme.textPrimary }
  }
  if (d.balanceHKD != null) return { label: "话费余额", value: `HK$ ${fmtMoney(d.balanceHKD)}`, color: theme.textPrimary }
  return { label: "代缴话费", value: "--", color: theme.textTertiary }
}

function SmallWidget({ data }: { data: UsageData }) {
  const main = bucketsOf(data)[0]
  const fee = FeeText({ d: data })
  return (
    <VStack spacing={6} padding={12} background={theme.cardBackground as any}>
      <HStack spacing={4}>
        <Image systemName="antenna.radiowaves.left.and.right" foregroundStyle={theme.accentGreen} frame={{ width: 12, height: 12 }} />
        <Text font="caption2" fontWeight="medium" foregroundStyle={theme.textSecondary} lineLimit={1}>
          {data.nickname || data.phoneNumber || data.accountNumber || "CMHK"}
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
      <Text font="caption2" foregroundStyle={theme.textSecondary}>
        {main ? `${shortLabel(main.name)} 剩 ${fmtGB(main.remainingGB)}/${fmtGB(main.totalGB)} GB` : "—"}
      </Text>
      <HStack alignment="lastTextBaseline" spacing={3}>
        <Text font="callout" fontWeight="bold" foregroundStyle={theme.textPrimary}>{fee.value}</Text>
        <Text font="caption2" foregroundStyle={theme.textTertiary}>{fee.label}</Text>
        <Spacer />
        <Text font="caption2" foregroundStyle={theme.textTertiary}>
          更新 {new Date(data.fetchedAt).getHours()}:{String(new Date(data.fetchedAt).getMinutes()).padStart(2, "0")}
        </Text>
      </HStack>
    </VStack>
  )
}

function MediumWidget({ data }: { data: UsageData }) {
  const buckets = bucketsOf(data)
  const main = buckets[0]
  const extras = buckets.slice(1).slice(0, 1) // 精简：最多 1 个附加流量桶
  const fee = FeeText({ d: data })
  const voice = data.voiceUnlimited
    ? (data.voiceRemainingMin != null ? `${fmtMin(data.voiceRemainingMin)} 分钟·∞` : "无限通话")
    : `${fmtMin(data.voiceRemainingMin)} 分钟`
  const member = data.membershipTier || data.points != null
  return (
    <HStack spacing={14} padding={14} background={theme.cardBackground as any}>
      <VStack spacing={4} alignment="center">
        <DataRing bucket={main} size={92} />
        <Text font="caption2" foregroundStyle={theme.textSecondary}>
          {main ? `剩 ${fmtGB(main.remainingGB)}/${fmtGB(main.totalGB)} GB` : "—"}
        </Text>
      </VStack>
      <VStack spacing={7} frame={{ maxWidth: "infinity" } as any}>
        <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary} lineLimit={1}>
          {data.planName ?? "CMHK"}
        </Text>
        <HStack spacing={5}>
          <Text font="caption2" foregroundStyle={theme.textTertiary} lineLimit={1}>
            {data.planName ? shortPlan(data.planName) : ""}
          </Text>
          {member && (
            <Text font="caption2" foregroundStyle="#FFD66E" lineLimit={1}>
              {data.membershipTier ?? ""}{data.points != null ? ` · ${data.points}分` : ""}
            </Text>
          )}
        </HStack>
        <Row icon="creditcard" label={fee.label} value={fee.value} color={fee.color} />
        <Row icon="phone" label="通话" value={voice} />
        {extras.map((b, i) => (
          <Row key={i} icon="arrow.down.circle" label={shortLabel(b.name)}
            value={`${fmtGB(b.remainingGB)} GB${expiryShort(b) ? ` · ${expiryShort(b)}止` : ""}`} />
        ))}
        <Spacer />
        <HStack spacing={4}>
          <Text font="caption2" foregroundStyle={theme.textTertiary}>
            更新于 {fmtUpdatedAt(data.fetchedAt)}{(() => { const n = daysUntilCycleEnd(data); return n != null ? ` · 剩${n}天` : "" })()}
          </Text>
          <Spacer />
          <Button intent={RefreshIntent(undefined)}>
            <Image systemName="arrow.clockwise" foregroundStyle={theme.textSecondary} frame={{ width: 12, height: 12 }} />
          </Button>
        </HStack>
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
