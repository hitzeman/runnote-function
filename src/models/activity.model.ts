export interface Activity {
  id: number;
  name: string;
  type: string; // e.g. "Run"
  sport_type: string; // e.g. "Run"
  start_date_local: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number; // meters
  average_speed: number; // m/s
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  suffer_score?: number | null;
  workout_type?: number | null; // 0: default, 1: race, 2: long run, etc.
  description?: string | null;
  device_name?: string | null;
  splits_metric?: Split[];
  splits_standard?: Split[];
  laps?: Lap[];
}

export interface Split {
  distance: number; // meters (≈1000 for metric)
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  split: number; // 1-based
  average_speed: number; // m/s
  average_heartrate?: number;
  elevation_difference?: number;
  pace_zone?: number;
}

export interface Lap {
  id: number;
  name: string;
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  average_speed: number; // m/s
  max_speed?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  pace_zone?: number;
}
