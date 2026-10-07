// widget.tsx — CMHK 用量小组件（systemSmall / systemMedium）
// CMHK 品牌栏 + 流量环 + 每桶明细(含漫遊59.7) + 欠費/通話；全繁体；分隔用 " | "。

import {
  Button,
  Circle,
  HStack,
  Image,
  Rectangle,
  Script,
  Spacer,
  Text,
  VStack,
  Widget,
  ZStack,
} from "scripting"
import { fmtGB, fmtMin, fmtMoney, fmtUpdatedAt, readCache, refreshUsage, UsageData } from "./cmhk"
import { RefreshIntent } from "./app_intents"
import { dataTierColor, ringStops, theme, usageRatio } from "./theme"

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
// 完整年月日（如 2026/10/06）；兼容 2026-10-06 / 2026.10.06 / ISO 时间前缀
function expiryFull(src?: string | null): string {
  if (!src) return ""
  const m = String(src).slice(0, 10).match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/)
  if (!m) return String(src).slice(0, 10)
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`
}
// v1.19.27 桶分类正则由标签/图标/圆环选择共用（此前三处各自维护，易漂移）。
// 判定顺序固定：加购 → 赠送 → 套餐（本地數據含"數據"，必须先于通用數據规则判定）。
const RE_ADDON = /本地數據|本地数据|日包|加購|加购/i
const RE_GIFT = /漫遊|漫游|贈送|赠送|extra/i
const RE_PLAN = /服務計劃|數據|数据/
type BucketKind = "addon" | "gift" | "plan" | "other"
function bucketKind(name: string): BucketKind {
  if (RE_ADDON.test(name)) return "addon"
  if (RE_GIFT.test(name)) return "gift"
  if (RE_PLAN.test(name)) return "plan"
  return "other"
}
function bucketLabel(name: string): string {
  // v1.19.24 额外购买流量包（本地數據，如"1天10GB本地數據"，短有效期 1~N 天）：
  // 此前命中 /數據/ 被误标"套餐內"——3 字与其它 2 字标签违和，且与主套餐混淆。
  const kind = bucketKind(name)
  if (kind === "addon") return "加购"
  if (kind === "gift") return "赠送"
  if (kind === "plan") return "套餐" // 套餐內(3字)→套餐(2字)，与全部标签对齐
  return name.length > 6 ? name.slice(0, 6) : name
}

// v1.19.24 桶图标三类区分（与主 App 页面约定一致：非主桶用 gift）：
// 套餐=arrow.down.circle（下载），加购=plus.circle（额外购买），赠送=gift（礼物）。
function bucketIcon(name: string): string {
  const kind = bucketKind(name)
  if (kind === "addon") return "plus.circle"
  if (kind === "gift") return "gift"
  return "arrow.down.circle"
}

// v1.19.27 加购包过期判定：expiry 当日仍有效，次日 0 点起算过期；日期未知视为未过期。
function isExpired(expiry?: string | null): boolean {
  if (!expiry) return false
  const t = new Date(String(expiry).slice(0, 10).replace(/-/g, "/")).getTime()
  if (!Number.isFinite(t)) return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return t < today.getTime()
}
// 过期加购一律不显示（圆环与右侧明细都过滤）
function isVisibleBucket(b: Bucket): boolean {
  return !(bucketKind(b.name) === "addon" && isExpired(b.expiry))
}

// v1.19.27 圆环桶选择（用户：圆环显示"当前正在消耗"的那一档流量）：
// 优先级 赠送(最先使用) → 套餐 → 加购(未过期)；上一档剩余为 0 才落到下一档。
// 剩余未知(null)不视为用完，避免解析缺失时圆环乱跳；全部用完回退套餐桶（显示 0%）。
function activeBucket(buckets: Bucket[]): Bucket | undefined {
  const usable = buckets.filter(isVisibleBucket)
  const gift = usable.find((b) => bucketKind(b.name) === "gift")
  const plan = usable.find((b) => { const k = bucketKind(b.name); return k === "plan" || k === "other" })
  const addon = usable.find((b) => bucketKind(b.name) === "addon")
  const hasLeft = (b?: Bucket) => !!b && (b.remainingGB ?? 1) > 0
  if (hasLeft(gift)) return gift
  if (hasLeft(plan)) return plan
  if (hasLeft(addon)) return addon
  return plan ?? gift ?? addon ?? usable[0]
}

function DataRing({ bucket, size }: { bucket?: Bucket; size: number }) {
  const ratio = ratioOf(bucket)
  const stops = ringStops(ratio ?? 1)
  const lw = Math.max(7, Math.round(size * 0.09))
  return (
    <ZStack frame={{ width: size, height: size }}>
      {/* 轨道：完整圆环，无端点（cap 无影响） */}
      <Circle stroke={{ shapeStyle: theme.ringTrack, strokeStyle: { lineWidth: lw } }} />
      {/* v1.19.22 已用段：剩余弧的补集（trim 0 → 1-ratio）。与剩余弧同用 -90° 旋转、
          平头端点，在 12 点与比例分界两处严丝合缝拼成完整圆环——用户提出"已用部分
          也应用颜色填充"，此前已用段只是 10% 白轨道，深蓝底上几乎隐形。 */}
      {ratio != null && (
        <Circle
          trim={{ from: 0, to: 1 - ratio }}
          stroke={{ shapeStyle: theme.ringUsed, strokeStyle: { lineWidth: lw } }}
          rotationEffect={-90}
        />
      )}
      {ratio != null && (
        <Circle
          // v1.19.21 进度方向：改画"结束于 12 点"的那一段（from: 1-ratio → 1），
          // 使彩弧从 12 点起**顺时针**展开；原先画 from 0 → ratio 是逆时针方向展开的。
          trim={{ from: 1 - ratio, to: 1 }}
          stroke={{
            shapeStyle: { gradient: [...stops], startPoint: { x: 0.5, y: 0 }, endPoint: { x: 0.5, y: 1 } },
            // v1.19.20：不加 lineCap（默认平头 butt）。此前设 round——圆头会让弧的两端各向外
            // 多凸出半个线宽：末端越过真实比例位置形成圆鼓，起始端（12 点逆时针方向）反过来
            // 啃进"已用"那一段，看上去就像圆环上缺了一块。平头端点让分界线与半径对齐，干净准确。
            strokeStyle: { lineWidth: lw },
          }}
          rotationEffect={-90}
        />
      )}
      <VStack spacing={0}>
        <Text font="title3" fontWeight="bold" foregroundStyle={dataTierColor(ratio)}>
          {ratio != null ? `${Math.round(ratio * 100)}%` : "--"}
        </Text>
        <Text font="caption2" foregroundStyle={theme.textSecondary}>流量剩餘</Text>
      </VStack>
    </ZStack>
  )
}

// valueColor 用于"只给数字上色"（如按剩余比例分级的数据量），图标仍保持自身语义色
function Row({ icon, label, value, color, valueColor }: { icon: string; label: string; value: string; color?: string; valueColor?: string }) {
  return (
    <HStack spacing={9} alignment="center">
      <Image systemName={icon} font={10} foregroundStyle={color ?? theme.accent} frame={{ width: 10, height: 10 }} />
      <Text font="caption2" foregroundStyle={theme.textSecondary}>{label}</Text>
      <Spacer />
      <Text font="footnote" fontWeight="semibold" foregroundStyle={valueColor ?? color ?? theme.textPrimary}>{value}</Text>
    </HStack>
  )
}

function FeeRow(d: UsageData): { label: string; value: string; color: string } {
  if (d.billAmountHKD != null) {
    const owed = d.billAmountHKD < 0
    return { label: "欠費", value: `HK$ ${fmtMoney(Math.abs(d.billAmountHKD))}`, color: owed ? "#FF6B5E" : theme.textPrimary }
  }
  if (d.balanceHKD != null) return { label: "餘額", value: `HK$ ${fmtMoney(d.balanceHKD)}`, color: theme.textPrimary }
  return { label: "欠費", value: "--", color: theme.textSecondary }
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
  const main = activeBucket(bucketsOf(data)) // v1.19.27：圆环按 赠送→套餐→加购 选择
  const fee = FeeRow(data)
  const idname = identity(data) || "CMHK"
  const tail = phoneTail(data)
  return (
    <ZStack alignment="bottomTrailing">
      <VStack spacing={7} padding={14} background={theme.cardBackground as any}>
      {/* 标题栏：CMHK + 套餐名（完整宽度，不放按钮防挤压） */}
      <HStack spacing={6} alignment="lastTextBaseline">
        <Text font="caption" fontWeight="bold" foregroundStyle={theme.accentGreen}>CMHK</Text>
        <Text font="caption" fontWeight="semibold" foregroundStyle={theme.textPrimary} lineLimit={1}>
          {shortPlan(data.planName ?? "")}
        </Text>
      </HStack>
      {/* 身份行：nickname | 尾號 */}
      <HStack spacing={4}>
        <Text font="caption2" foregroundStyle={theme.textSecondary} lineLimit={1}>
          {idname}{tail && !/^尾號/.test(idname) ? ` | ${tail}` : ""}
        </Text>
        {data.membershipTier && (
          <Image systemName="crown.fill" font={9} foregroundStyle="#FFD66E" frame={{ width: 9, height: 9 }} />
        )}
      </HStack>
      <Spacer />
      <VStack spacing={8} alignment="center">
        <DataRing bucket={main} size={78} />
        <Text font="caption2" fontWeight="semibold" foregroundStyle={main ? dataTierColor(ratioOf(main)) : theme.textSecondary}>
          {main ? `${bucketLabel(main.name)} ${fmtGB(main.remainingGB)} | ${fmtGB(main.totalGB)} GB` : "—"}
        </Text>
      </VStack>
      <Spacer />
      <HStack alignment="lastTextBaseline" spacing={4}>
        <Text font="callout" fontWeight="bold" foregroundStyle={theme.textPrimary}>{fee.value}</Text>
        <Text font="caption2" foregroundStyle={theme.textSecondary}>{fee.label}</Text>
        <Spacer />
      </HStack>
      </VStack>
      {/* 角落悬浮刷新按钮（右下角）：plain 无底色；图标内缩 11pt 避开圆角裁切 */}
      <Button intent={RefreshIntent(undefined)} buttonStyle="plain">
        <ZStack frame={{ width: 24, height: 24 }}>
          <Image systemName="arrow.clockwise" font={8} foregroundStyle={theme.textTertiary} frame={{ width: 8, height: 8 }} offset={{ x: -3, y: -3 }} />
        </ZStack>
      </Button>
    </ZStack>
  )
}

function MediumWidget({ data }: { data: UsageData }) {
  const buckets = bucketsOf(data)
  const main = activeBucket(buckets) // v1.19.27：圆环按 赠送→套餐→加购 选择
  // 其余流量桶：圆环已占的桶除外；v1.19.27 过期加购不显示。若缺漫遊则用 roam 标量补齐（确保 59.7 一定显示）
  const bucketExtras = buckets.filter((b) => b !== main && isVisibleBucket(b))
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
  // v1.19.27 重置日始终看套餐桶：圆环可能正显示赠送/加购，其 expiry 是流量包失效日而非账单重置日
  const planBucket = buckets.find((b) => bucketKind(b.name) === "plan")
  const cycleExp = planBucket?.expiry || data.cycleEndDate || null
  return (
    <ZStack alignment="bottomLeading">
      {/* 背景+品牌水印合为一层：渐变铺满整卡，徽标垂直居中垫于左块之下（不参与内容布局）。
          教训（v1.19.7）：水印不能放在内容层之下——不透明渐变挂在内容上会盖住它；必须与渐变同层且在内容之下 */}
      <VStack alignment="leading" frame={{ maxWidth: "infinity", maxHeight: "infinity" } as never} background={theme.cardBackground as any}>
        <Spacer />
        <Image
          filePath={`${Script.directory}/assets/cmhk-mark-watermark.png`}
          resizable={true}
          scaleToFit={true}
          frame={{ width: 130, height: 130 }}
          offset={{ x: 8, y: 0 }}
        />
        <Spacer />
      </VStack>
      <HStack spacing={10} padding={14}>
      {/* 左：主数据环 */}
      <VStack spacing={8} alignment="center">
        <DataRing bucket={main} size={84} />
        <Text font="caption2" fontWeight="semibold" foregroundStyle={main ? dataTierColor(ratioOf(main)) : theme.textSecondary}>
          {main ? `${bucketLabel(main.name)} ${fmtGB(main.remainingGB)} | ${fmtGB(main.totalGB)} GB` : "—"}
        </Text>
      </VStack>
      {/* 中：竖向分割线（左环与右侧明细的视觉分割） */}
      <Rectangle fill={theme.divider} frame={{ width: 1, maxHeight: "infinity" }} />
      {/* 右：标题=套餐名 + 身份 + 明细 */}
      <VStack spacing={5} alignment="leading" frame={{ maxWidth: "infinity" } as never}>
        {/* 标题栏：CMHK 品牌 + 套餐名 —— 右栏内水平居中，行内基线对齐保留 */}
        <VStack alignment="center" frame={{ maxWidth: "infinity" } as never}>
          <HStack spacing={8} alignment="lastTextBaseline">
            <Text font="subheadline" fontWeight="bold" foregroundStyle={theme.accentGreen}>CMHK</Text>
            <Text font="subheadline" fontWeight="semibold" foregroundStyle={theme.textPrimary} lineLimit={1}>
              {shortPlan(data.planName ?? "")}
            </Text>
          </HStack>
        </VStack>
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
        </HStack>
        <Row icon="creditcard" label={fee.label} value={fee.value} color={fee.color} />
        <Row icon="phone" label="通話" value={voiceValue(data)} />
        {extras.map((b, i) => (
          <Row key={i} icon={bucketIcon(b.name)} label={bucketLabel(b.name)}
            value={`${fmtGB(b.remainingGB)} | ${fmtGB(b.totalGB)} GB`}
            valueColor={dataTierColor(usageRatio(b.totalGB, b.remainingGB))} />
        ))}
        {cycleExp && (
          <Row icon="arrow.triangle.2.circlepath" label="重置" value={expiryFull(cycleExp)} color={theme.textSecondary} />
        )}
      </VStack>
      </HStack>
      {/* 角落悬浮刷新按钮（左下角，环下方空白区）：plain 无底色；图标内缩 11pt 避开圆角裁切 */}
      <Button intent={RefreshIntent(undefined)} buttonStyle="plain">
        <ZStack frame={{ width: 24, height: 24 }}>
          <Image systemName="arrow.clockwise" font={8} foregroundStyle={theme.textTertiary} frame={{ width: 8, height: 8 }} offset={{ x: 3, y: -3 }} />
        </ZStack>
      </Button>
    </ZStack>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <VStack spacing={8} padding={16} background={theme.cardBackground as any} alignment="center">
      <Spacer />
      <Image systemName="antenna.radiowaves.left.and.right.slash" font={24} foregroundStyle={theme.textTertiary} frame={{ width: 24, height: 24 }} />
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
        refreshUsage({ directOnly: true, via: "widget" }),
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
    reloadPolicy: { policy: "after", date: new Date(Date.now() + 15 * 60 * 1000) },
  })
}

run()
