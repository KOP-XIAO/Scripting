import { HStack, RoundedRectangle, Spacer, TabView, Text, VStack } from "scripting"
import { TripCard } from "./trip-card"
import type { Theme } from "../services/theme"
import type { PassengerMode, TripRecord } from "../services/trips"

export function TripPreviewCarousel({ trips, theme, passengerMode, hideSeatNumber, now }: {
  trips: TripRecord[]; theme: Theme; passengerMode: PassengerMode; hideSeatNumber: boolean; now: number
}) {
  if (!trips.length) return null
  if (trips.length === 1) return <TripCard trip={trips[0]} theme={theme} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} now={now} />
  return <VStack spacing={4}>
    <TabView tabViewStyle="page" frame={{ height: 250 }}>
      {trips.map((trip, page) => <VStack key={trip.id} spacing={6} padding={{ bottom: 30 }}>
        <HStack spacing={8}>
          <Text font="caption2" foregroundStyle="secondaryLabel">左右滑动切换行程</Text>
          <Spacer />
          <Text font="caption" fontWeight="semibold" monospacedDigit foregroundStyle={theme.badgeInk ?? "#FFFFFF"}
            padding={{ leading: 8, trailing: 8, top: 3, bottom: 3 }} background={theme.accent}
            clipShape={{ type: "rect", cornerRadius: 7 }} accessibilityLabel={`第 ${page + 1} 条行程，共 ${trips.length} 条`}>
            {`${page + 1}/${trips.length}`}
          </Text>
        </HStack>
        <TripCard trip={trip} theme={theme} passengerMode={passengerMode} hideSeatNumber={hideSeatNumber} now={now} />
      </VStack>)}
    </TabView>
    <RoundedRectangle cornerRadius={1.5} fill="#808085"
      frame={{ width: 32, height: 3 }} accessibilityHidden={true} />
  </VStack>
}
