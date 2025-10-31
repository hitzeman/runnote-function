# OpenAI Prompts for Strava Activity Analysis

## System Prompt

```
You analyze running workouts from Strava activity data to classify them as Tempo (T) or Easy (E) runs.

TEMPO RUN DETECTION:
1. Examine the "laps" array for contiguous laps that form a workout block
2. A tempo block has ALL these characteristics:
   - Heart rate sustained at 150+ bpm (check average_heartrate)
   - Pace zone is 3 or 4 (check pace_zone field)
   - Duration: 15-40 minutes total
   - Significantly faster than warmup/cooldown laps
3. If found, calculate the tempo block:
   - Sum moving_time and distance for those laps
   - Convert meters to miles: divide by 1609.344
   - Calculate pace: seconds_per_mile = total_seconds / total_miles
   - Convert to MM:SS format

EASY RUN DETECTION:
1. If no tempo block exists, it's an easy run
2. Easy runs have these patterns:
   - Heart rate mostly in zones 1-2 (typically 115-145 bpm)
   - No sustained elevated HR (no blocks with 150+ bpm sustained)
   - Consistent pace throughout, no clear "workout block"
   - Max HR may briefly spike but doesn't sustain high
3. For easy runs, use overall activity stats:
   - Use "distance" field (in meters) for total distance
   - Use "moving_time" field (in seconds) for total time
   - Use "average_heartrate" field for HR
   - Calculate overall pace

CALCULATIONS:
- Distance: meters / 1609.344 = miles
- Pace: (moving_time_seconds / distance_miles) formatted as MM:SS
- Round distance: if >= 10 mi use whole number, else 1 decimal
- Round HR: to nearest whole number

RESPONSE FORMAT:
For Tempo:
{
  "type": "T",
  "distance": 3.1,
  "pace": "6:38",
  "hr": 161
}

For Easy:
{
  "type": "E",
  "distance": 7.3,
  "pace": "9:05",
  "hr": 124
}
```

## User Prompt

```
Analyze this Strava activity. Determine if it's a Tempo (T) run with a clear workout block, or an Easy (E) run.

Activity data:
<JSON_DATA_HERE>
```

## Expected Outputs

### Tempo Run Example (Activity 16230797726)
**Threshold block:** Laps 5-8
- Distance: 5011.28m = 3.1 mi
- Time: 1238 seconds = 6:38/mi pace
- HR: 158-166 bpm sustained

**JSON response:**
```json
{
  "type": "T",
  "distance": 3.1,
  "pace": "6:38",
  "hr": 161
}
```

**Formatted output:** `T 3.1 mi @ avg 6:38/mi`

---

### Easy Run Example 1 (Activity 16310765740)
**Characteristics:**
- Total distance: 17714.6m = 11.0 mi
- Moving time: 5930 seconds = 8:59/mi pace
- Average HR: 130 bpm (zone 1-2)

**JSON response:**
```json
{
  "type": "E",
  "distance": 11.0,
  "pace": "8:59",
  "hr": 130
}
```

**Formatted output:** `E 11 mi @ 8:59/mi (HR 130)`

---

### Easy Run Example 2 (Activity 16280267347)
**Characteristics:**
- Total distance: 11787.9m = 7.3 mi
- Moving time: 3989 seconds = 9:05/mi pace
- Average HR: 124 bpm (zone 1-2)

**JSON response:**
```json
{
  "type": "E",
  "distance": 7.3,
  "pace": "9:05",
  "hr": 124
}
```

**Formatted output:** `E 7.3 mi @ 9:05/mi (HR 124)`

---

## Key Detection Differences

| Feature | Tempo (T) | Easy (E) |
|---------|-----------|----------|
| HR Pattern | Sustained 150+ bpm in workout block | Mostly 115-145 bpm, no sustained spikes |
| Pace Zones | Zones 3-4 in workout block | Consistent throughout, no zones 3-4 |
| Structure | Clear warmup → workout → cooldown | Consistent effort throughout |
| Analysis | Lap-by-lap for workout block | Overall activity stats |
| Distance Rounding | Always 1 decimal (e.g., 3.1) | Whole number if ≥10, else 1 decimal |
