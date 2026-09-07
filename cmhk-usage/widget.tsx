// widget.tsx — CMHK 用量小组件（systemSmall / systemMedium）
// CMHK 品牌栏 + 流量环 + 每桶明细(含漫遊59.7) + 欠費/通話；全繁体；分隔用 " | "。

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
import { fmtGB, fmtMin, fmtMoney, fmtUpdatedAt, readCache, refreshUsage, UsageData } from "./cmhk"
import { RefreshIntent } from "./app_intents"
import { ringStops, theme } from "./theme"

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
// 身份：nickname > 尾號
function identity(d: UsageData): string {
  if (d.nickname) return d.nickname
  const s = (d.phoneNumber || d.accountNumber || "")
  const m = s.match(/(\d{4})$/)
  return m ? `尾號 ${m[1]}` : ""
}
function phoneTail(d: UsageData): string {
  const m = (d.phoneNumber || d.accountNumber || "").match(/(\d{4})$/)
  return m ? m[1] : ""
}
function shortPlan(p: string): string {
  const m = p.match(/^(.+?計劃)\d+/)
  return m ? m[1] : p
}
function tierLabel(t: string): string {
  return /白金|鑽石|钻石|铂金|铂|金|銀|银|铜|優越|privilege/i.test(t) ? `${t}會籍` : t
}
function expiryShort(b?: Bucket): string {
  const e = b?.expiry
  return e ? e.slice(5).replace("-", "/") : ""
}
function bucketLabel(name: string): string {
  if (/漫遊|漫游|贈送|赠送|extra/i.test(name)) return "赠送"
  if (/服務計劃|數據|数据/.test(name)) return "套餐內"
  return name.length > 6 ? name.slice(0, 6) : name
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
        <Text font="caption2" foregroundStyle={theme.textTertiary}>流量剩餘</Text>
      </VStack>
    </ZStack>
  )
}

function Row({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <HStack spacing={9} alignment="center">
      <Image systemName={icon} foregroundStyle={color ?? theme.accent} frame={{ width: 9, height: 9 }} />
      <Text font="caption2" foregroundStyle={theme.textTertiary}>{label}</Text>
      <Spacer />
      <Text font="footnote" fontWeight="semibold" foregroundStyle={color ?? theme.textPrimary}>{value}</Text>
    </HStack>
  )
}

function FeeRow(d: UsageData): { label: string; value: string; color: string } {
  if (d.billAmountHKD != null) {
    const owed = d.billAmountHKD < 0
    return { label: "欠費", value: `HK$ ${fmtMoney(Math.abs(d.billAmountHKD))}`, color: owed ? "#FF6B5E" : theme.textPrimary }
  }
  if (d.balanceHKD != null) return { label: "餘額", value: `HK$ ${fmtMoney(d.balanceHKD)}`, color: theme.textPrimary }
  return { label: "欠費", value: "--", color: theme.textTertiary }
}
function voiceValue(d: UsageData): string {
  if (d.voiceUnlimited) return `${fmtMin(d.voiceRemainingMin)} 分鐘 | ∞`
  return `${fmtMin(d.voiceRemainingMin)} 分鐘`
}

// CMHK 品牌栏
function BrandBar({ compact }: { compact: boolean }) {
  return (
    <HStack spacing={5} alignment="center">
      <Text font={compact ? "caption2" : "caption"} fontWeight="bold" foregroundStyle={theme.accentGreen}>CMHK</Text>
      <Text font="caption2" foregroundStyle={theme.textTertiary}>中國移動香港</Text>
    </HStack>
  )
}

function SmallWidget({ data }: { data: UsageData }) {
  const main = bucketsOf(data)[0]
  const fee = FeeRow(data)
  const idname = identity(data) || "CMHK"
  const tail = phoneTail(data)
  return (
    <VStack spacing={7} padding={14} background={theme.cardBackground as any}>
      {/* 标题栏：CMHK + 套餐名 + 刷新按钮（内联右置，不占额外高度） */}
      <HStack spacing={6} alignment="lastTextBaseline">
        <Text font="caption" fontWeight="bold" foregroundStyle={theme.accentGreen}>CMHK</Text>
        <Text font="caption" fontWeight="semibold" foregroundStyle={theme.textPrimary} lineLimit={1}>
          {shortPlan(data.planName ?? "")}
        </Text>
        <Spacer />
        <Button intent={RefreshIntent(undefined)}>
          <Image systemName="arrow.clockwise" foregroundStyle={theme.textTertiary} frame={{ width: 10, height: 10 }} />
        </Button>
      </HStack>
      {/* 身份行：nickname | 尾號 */}
      <HStack spacing={4}>
        <Text font="caption2" foregroundStyle={theme.textSecondary} lineLimit={1}>
          {idname}{tail && !/^尾號/.test(idname) ? ` | ${tail}` : ""}
        </Text>
        {data.membershipTier && (
          <Image systemName="crown.fill" foregroundStyle="#FFD66E" frame={{ width: 8, height: 8 }} />
        )}
        {data.stale && (
          <Text font="caption2" foregroundStyle="#FFD66E">快取</Text>
        )}
      </HStack>
      <Spacer />
      <VStack spacing={8} alignment="center">
        <DataRing bucket={main} size={78} />
        <Text font="caption2" foregroundStyle={theme.textSecondary}>
          {main ? `剩餘 ${fmtGB(main.remainingGB)} | ${fmtGB(main.totalGB)} GB` : "—"}
        </Text>
      </VStack>
      <Spacer />
      <HStack alignment="lastTextBaseline" spacing={4}>
        <Text font="callout" fontWeight="bold" foregroundStyle={theme.textPrimary}>{fee.value}</Text>
        <Text font="caption2" foregroundStyle={theme.textTertiary}>{fee.label}</Text>
        <Spacer />
      </HStack>
    </VStack>
  )
}

function MediumWidget({ data }: { data: UsageData }) {
  const buckets = bucketsOf(data)
  const main = buckets[0]
  // 其余流量桶：优先桶数组，若缺漫遊则用 roam 标量补齐（确保 59.7 一定显示）
  const bucketExtras = buckets.slice(1)
  const roamScalar = data.roamDataRemainingGB != null
    ? { name: "漫遊數據", totalGB: data.roamDataTotalGB, remainingGB: data.roamDataRemainingGB, expiry: data.roamExpiry }
    : null
  const extras = [
    ...bucketExtras,
    ...(roamScalar && !bucketExtras.some((b) => /漫遊|漫游/.test(b.name)) ? [roamScalar] : []),
  ].slice(0, 2)
  const fee = FeeRow(data)
  const idname = identity(data)
  const tail = phoneTail(data)
  const member = data.membershipTier || data.points != null
  const cycleExp = main?.expiry || data.cycleEndDate || null
  return (
    <HStack spacing={14} padding={14} background={theme.cardBackground as any}>
      {/* 左：主数据环 */}
      <VStack spacing={8} alignment="center">
        <DataRing bucket={main} size={84} />
        <Text font="caption2" foregroundStyle={theme.textSecondary}>
          {main ? `剩餘 ${fmtGB(main.remainingGB)} | ${fmtGB(main.totalGB)} GB` : "—"}
        </Text>
      </VStack>
      {/* 右：标题=套餐名 + 身份 + 明细 */}
      <VStack spacing={5} frame={{ maxWidth: "infinity" } as never}>
        {/* 标题栏：CMHK 品牌 + 套餐名 + 刷新按钮（内联右置，不占额外高度） */}
        <HStack spacing={8} alignment="lastTextBaseline">
          <Text font="subheadline" fontWeight="bold" foregroundStyle={theme.accentGreen}>CMHK</Text>
          <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary} lineLimit={1}>
            {shortPlan(data.planName ?? "")}
          </Text>
          <Spacer />
          <Button intent={RefreshIntent(undefined)}>
            <Image systemName="arrow.clockwise" foregroundStyle={theme.textTertiary} frame={{ width: 11, height: 11 }} />
          </Button>
        </HStack>
        {/* 身份行：nickname | 尾號 | 會籍 | 積分 */}
        <HStack spacing={6}>
          {idname && (
            <Text font="caption2" foregroundStyle={theme.textTertiary} lineLimit={1}>
              {idname}{tail && !/^尾號/.test(idname) ? ` | ${tail}` : ""}
            </Text>
          )}
          {member && (
            <Text font="caption2" foregroundStyle="#FFD66E" lineLimit={1}>
              {data.membershipTier ? `${tierLabel(data.membershipTier)} |` : ""}{data.points != null ? ` ${data.points}分` : ""}
            </Text>
          )}
          {data.stale && (
            <Text font="caption2" foregroundStyle="#FFD66E">快取</Text>
          )}
        </HStack>
        <Row icon="creditcard" label={fee.label} value={fee.value} color={fee.color} />
        <Row icon="phone" label="通話" value={voiceValue(data)} />
        {extras.map((b, i) => (
          <Row key={i} icon="arrow.down.circle" label={bucketLabel(b.name)}
            value={`${fmtGB(b.remainingGB)} | ${fmtGB(b.totalGB)} GB`} />
        ))}
        {cycleExp && (
          <Row icon="calendar" label="到期" value={`${expiryShort(main!)}`} color={theme.textSecondary} />
        )}
        <Spacer />
      </VStack>
    </HStack>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <VStack spacing={8} padding={16} background={theme.cardBackground as any} alignment="center">
      <Spacer />
      <Image systemName="antenna.radiowaves.left.and.right.slash" foregroundStyle={theme.textTertiary} frame={{ width: 24, height: 24 }} />
      <Text font="caption" foregroundStyle={theme.textSecondary} multilineTextAlignment="center">{message}</Text>
      <Spacer />
    </VStack>
  )
}

async function run() {
  let data = readCache()
  // 自动更新：渲染前先试一次直连快路径（约 5 秒内完成，不创建 WebView，
  // 适配 widget 进程的时间/内存预算）。缓存新鲜（15 分钟内且非快取）时跳过，
  // 避免系统密集重载时频繁请求接口。
  const cacheFresh = data && data.stale !== true && Date.now() - data.fetchedAt < 15 * 60 * 1000
  if (!cacheFresh) {
    try {
      const fresh = await Promise.race([
        refreshUsage({ directOnly: true }),
        new Promise<null>((r) => setTimeout(() => r(null), 7000)),
      ])
      if (fresh) data = fresh
    } catch { /* 直连失败：回退缓存渲染 */ }
  }
  if (!data) {
    Widget.present(<EmptyState message={"請先開啟 App 內的「CMHK Usage」完成登入"} />, {
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
