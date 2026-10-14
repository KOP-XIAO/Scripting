import { HStack, Image, Spacer, Text, VStack } from "scripting"
import { countdownText, durationText, gateLabel, monthDayText, weekdayText } from "../services/parse"
import { displayPassenger, displaySeat, type PassengerMode, type TripRecord } from "../services/trips"
import type { Theme } from "../services/theme"
import { ThemeBackground } from "./theme-background"

export function TripCard({ trip, theme, passengerMode, hideSeatNumber, now }: {
  trip: TripRecord; theme: Theme; passengerMode: PassengerMode; hideSeatNumber: boolean; now: number
}) {
  const passenger = displayPassenger(trip.passenger, passengerMode)
  return (
    <VStack alignment="leading" spacing={12} padding={14}
      frame={{ maxWidth: "infinity" } as never}
      background={<ThemeBackground theme={theme} />}
      clipShape={{ type: "rect", cornerRadius: 12, style: "continuous" }}>
      <HStack spacing={6}>
        <Image systemName={trip.mode === "flight" ? "airplane.departure" : "tram.fill"}
          font={14} foregroundStyle={theme.accent} />
        <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.badgeInk ?? "#FFFFFF"}
          padding={{ top: 2, bottom: 2, leading: 6, trailing: 6 }} background={theme.accent}
          clipShape={{ type: "rect", cornerRadius: 6, style: "continuous" }}>{trip.code || "—"}</Text>
        <Spacer />
        <Text font="caption" foregroundStyle={theme.sub} lineLimit={1}>
          {monthDayText(trip.departDate)} {weekdayText(trip.departDate)}
        </Text>
      </HStack>
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={2}>
          <Text font="title3" fontWeight="semibold" monospaced foregroundStyle={theme.ink}>{trip.departTime || "--:--"}</Text>
          <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>{trip.fromPlace || "—"}</Text>
        </VStack>
        <Image systemName="arrow.right" font={12} foregroundStyle={theme.sub} />
        <VStack alignment="leading" spacing={2}>
          <Text font="title3" fontWeight="semibold" monospaced foregroundStyle={theme.ink}>{trip.arriveTime || "--:--"}</Text>
          <Text font="caption" foregroundStyle={theme.ink} lineLimit={1}>{trip.toPlace || "—"}</Text>
        </VStack>
        <Spacer />
        <Text font="caption2" foregroundStyle={theme.sub} lineLimit={1}>{durationText(trip)}</Text>
      </HStack>
      <Text font="headline" fontWeight="bold" monospaced foregroundStyle={theme.accent} lineLimit={1}>
        {countdownText(trip, now)}
      </Text>
      <HStack alignment="top" spacing={16}>
        <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" } as never}>
          <Text font="caption2" foregroundStyle={theme.sub}>{gateLabel(trip.mode)}</Text>
          <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.accent} lineLimit={1}>{trip.gate || "—"}</Text>
        </VStack>
        <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity" } as never}>
          <Text font="caption2" foregroundStyle={theme.sub}>座位</Text>
          <Text font="title2" fontWeight="bold" monospaced foregroundStyle={theme.accent} lineLimit={1}>{hideSeatNumber ? "已隐藏" : displaySeat({ ...trip, seatClass: "" }, false)}</Text>
          {trip.seatClass ? <Text font="caption2" foregroundStyle={theme.sub}>{trip.seatClass}</Text> : null}
        </VStack>
      </HStack>
      {trip.carrier || passenger || (trip.mode === "flight" && trip.boardingTime) ? (
        <Text font="caption" foregroundStyle={theme.sub} lineLimit={2}>
          {[trip.carrier, trip.mode === "flight" && trip.boardingTime ? `登机 ${trip.boardingTime}` : "", passenger].filter(Boolean).join(" · ")}
        </Text>
      ) : null}
    </VStack>
  )
}
