export interface TempPreset {
  kelvin: number
  label: string
  hex: string
}

export const TEMP_PRESETS: TempPreset[] = [
  { kelvin: 1800, label: '1 800 K', hex: '#FF7E00' },
  { kelvin: 2700, label: '2 700 K', hex: '#FFA961' },
  { kelvin: 3400, label: '3 400 K', hex: '#FFC184' },
  { kelvin: 5200, label: '5 200 K', hex: '#FFE8D5' },
  { kelvin: 6000, label: '6 000 K', hex: '#FFF3EF' },
  { kelvin: 6500, label: '6 500 K', hex: '#FFF9FD' },
  { kelvin: 7000, label: '7 000 K', hex: '#F5F3FF' },
  { kelvin: 9000, label: '9 000 K', hex: '#D6E1FF' },
  { kelvin: 10000, label: '10 000 K', hex: '#CFDAFF' },
  { kelvin: 12000, label: '12 000 K', hex: '#C3D1FF' },
]

export interface FilterState {
  hex: string | null
  opacity: number
}

export const DEFAULT_FILTER: FilterState = { hex: null, opacity: 50 }
