import { Image, Script, Spacer, VStack } from "scripting"
import type { Theme } from "../services/theme"

// Used as a background so artwork follows content size rather than setting card height.
export function ThemeBackground({ theme }: { theme: Theme }) {
  return theme.backgroundAsset ? (
    <Image filePath={`${Script.directory}/assets/${theme.backgroundAsset}`} resizable={true} />
  ) : (
    <VStack background={{
      gradient: [{ color: theme.cardTop, location: 0 }, { color: theme.cardBottom, location: 1 }],
      startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 },
    }}><Spacer /></VStack>
  )
}
