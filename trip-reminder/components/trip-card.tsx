import { Text, VStack } from "scripting"
import { displayPassenger, type PassengerMode, type TripRecord } from "../services/trips"
import type { Theme } from "../services/theme"
import { TripWidgetPreview } from "./trip-widget"

export function TripCard({ trip, theme, passengerMode, hideSeatNumber, now }: {
  trip: TripRecord; theme: Theme; passengerMode: PassengerMode; hideSeatNumber: boolean; now: number
}) {
  const passenger = displayPassenger(trip.passenger, passengerMode)
  return (
    <VStack alignment="leading" spacing={8}>
      <TripWidgetPreview trip={trip} theme={theme} now={now} hideSeatNumber={hideSeatNumber} />
      {passenger ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>乘客：{passenger}</Text> : null}
    </VStack>
  )
}
