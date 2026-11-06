import { HStack, Slider, Spacer, Tab, TabView, Text, VStack, useEffect, useObservable } from "scripting"
import { TripCard } from "./trip-card"
import type { Theme } from "../services/theme"
import type { PassengerMode, TripRecord } from "../services/trips"

export function TripPreviewCarousel({ trips, theme, passengerMode, hideSeatNumber, now }: {
  trips: TripRecord[]; theme: Theme; passengerMode: PassengerMode; hideSeatNumber: boolean; now: number
}) {
  const selection = useObservable<string>(() => trips[0]?.id ?? "")
  const index = Math.max(0, trips.findIndex(trip => trip.id === selection.value))
  useEffect(() => {
    // Keep the selected trip through reordering; a removed selection returns to the first available trip.
    if (!trips.some(trip => trip.id === selection.value)) selection.value = trips[0]?.id ?? ""
  }, [trips, selection])

  if (!trips.length) return null
  if (trips.length === 1) return <TripCard trip={trips[0]} theme={theme} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} now={now} />
  return <VStack spacing={6}>
    <HStack spacing={8}>
      <Text font="caption2" foregroundStyle="secondaryLabel">左右滑动切换行程</Text>
      <Spacer />
      <Text font="caption" fontWeight="semibold" monospacedDigit foregroundStyle={theme.badgeInk ?? "#FFFFFF"}
        padding={{ leading: 8, trailing: 8, top: 3, bottom: 3 }} background={theme.accent}
        clipShape={{ type: "rect", cornerRadius: 7 }} accessibilityLabel={`第 ${index + 1} 条行程，共 ${trips.length} 条`}>
        {`${index + 1}/${trips.length}`}
      </Text>
    </HStack>
    <TabView selection={selection} tabViewStyle="page" frame={{ height: 220 }}>
      {trips.map((trip, page) => <Tab key={trip.id} title={trip.code || `行程 ${page + 1}`}
        systemImage={trip.mode === "flight" ? "airplane" : "tram.fill"} value={trip.id}>
        <VStack spacing={0} padding={{ bottom: 30 }}>
          <TripCard trip={trip} theme={theme} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} now={now} />
        </VStack>
      </Tab>)}
    </TabView>
    <Slider value={index + 1} min={1} max={trips.length} step={1} tint="accentColor"
      accessibilityLabel="切换预览行程" frame={{ height: 28 }}
      onChanged={value => {
        if (!Number.isFinite(value)) return
        const page = Math.min(trips.length - 1, Math.max(0, Math.round(value) - 1))
        selection.value = trips[page].id
      }} />
  </VStack>
}
