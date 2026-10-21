// Bound native bridge calls as well as network response bodies.
export async function withTimeout<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时`)), ms)
      }),
    ])
  } finally {
    if (timer != null) clearTimeout(timer)
  }
}
