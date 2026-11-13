export type TrackId = "practice" | "mountain" | "coast" | "city";
export interface TrackDefinition {
  id: TrackId;
  name: string;
  theme: TrackId;
  width: number;
  samples: number;
  points: readonly (readonly [number, number, number])[];
}
export const TRACKS: readonly TrackDefinition[] = [
  {
    id: "practice",
    name: "松岭试车场",
    theme: "practice",
    width: 16,
    samples: 240,
    points: [
      [-100, 0, -150],
      [-100, 0, -45],
      [-95, 0, 65],
      [-55, 0, 145],
      [40, 0, 165],
      [125, 0, 110],
      [145, 0, 10],
      [100, 0, -95],
      [15, 0, -145],
    ],
  },
  {
    id: "mountain",
    name: "云岭山地环线",
    theme: "mountain",
    width: 16,
    samples: 720,
    points: [
      [-430, 4, -480],
      [-480, 12, -160],
      [-420, 36, 240],
      [-210, 62, 480],
      [140, 48, 510],
      [440, 25, 330],
      [500, 14, -40],
      [350, 7, -390],
      [-70, 3, -520],
    ],
  },
  {
    id: "coast",
    name: "碧湾沿海公路",
    theme: "coast",
    width: 16,
    samples: 720,
    points: [
      [-500, 5, -500],
      [-530, 5, -120],
      [-390, 12, 300],
      [-100, 20, 510],
      [300, 8, 470],
      [540, 6, 140],
      [450, 5, -230],
      [90, 6, -520],
    ],
  },
  {
    id: "city",
    name: "新港城市赛道",
    theme: "city",
    width: 16,
    samples: 720,
    points: [
      [-460, 1, -460],
      [-460, 1, 0],
      [-420, 2, 420],
      [30, 6, 480],
      [460, 8, 420],
      [460, 3, -20],
      [400, 1, -460],
      [0, 1, -500],
    ],
  },
];
