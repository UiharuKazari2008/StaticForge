# Period Time Ranges Documentation

This document outlines the exact time ranges for each period in the time calculation system.

## Period Priority Order
Periods are checked in this order (highest priority first):
1. Sunrise
2. Sunset
3. Dawn
4. Dusk
5. Golden Hour
6. Midday
7. Midnight/Night

## Period Ranges

### 1. **Dawn**
- **Range**: `sunriseHour - 0.5` to `sunriseHour` (30 minutes before sunrise)
- **Intensity Threshold**: `> 0.1` (for period determination)
- **Intensity Calculation**: `(sunriseHour - currentHour) / 0.5`
- **Conditions**: 
  - `currentHour >= dawnStartHour && currentHour < sunriseHour`
  - `dawnIntensity > 0.1`
- **Example**: If sunrise is at 6:52 AM, dawn is 6:22 AM - 6:52 AM

### 2. **Sunrise**
- **Range**: `sunriseHour - 0.25` to `sunriseHour + 0.25` (15 minutes around sunrise)
- **Intensity Threshold**: `> 0.5` (for period determination)
- **Intensity Calculation**: `1.0 - (|currentHour - sunriseHour| / 0.25 * 4)`
- **Peak**: Exactly at `sunriseHour` (intensity = 1.0)
- **Example**: If sunrise is at 6:52 AM, sunrise period is 6:37 AM - 7:07 AM

### 3. **Golden Hour (Morning)**
- **Range**: `sunriseHour + 0.25` to `sunriseHour + 1.5` (90 minutes after sunrise, excluding sunrise transition)
- **Intensity Threshold**: `> 0.3` (for period determination)
- **Intensity Calculation**: `1.0 - (hoursFromSunrise / 1.5)`
- **Conditions**:
  - `isDaylight === true`
  - `currentHour >= sunriseHour`
  - `sunriseIntensity === 0` (not during sunrise transition)
  - `goldenMorningIntensity > 0.3`
- **Example**: If sunrise is at 6:52 AM, golden hour morning is 7:07 AM - 8:22 AM

### 4. **Midday**
- **Range**: `solarNoon - 2.0` to `solarNoon + 2.0` (±2 hours around solar noon)
- **Intensity Threshold**: `> 0.7` (for period determination)
- **Intensity Calculation**: `1.0 - (|currentHour - solarNoon| / 2.0)`
- **Peak**: Exactly at `solarNoon` (intensity = 1.0)
- **Example**: If solar noon is 11:52 AM, midday is 9:52 AM - 1:52 PM

### 5. **Golden Hour (Afternoon)**
- **Range**: `sunsetHour - 1.5` to `sunsetHour - 0.25` (90 minutes before sunset, excluding sunset transition)
- **Intensity Threshold**: `> 0.3` (for period determination)
- **Intensity Calculation**: `1.0 - (hoursToSunset / 1.5)`
- **Conditions**:
  - `isDaylight === true`
  - `currentHour < sunsetHour`
  - `sunsetIntensity === 0` (not during sunset transition)
  - `goldenAfternoonIntensity > 0.3`
- **Example**: If sunset is at 4:52 PM, golden hour afternoon is 3:22 PM - 4:37 PM

### 6. **Sunset**
- **Range**: `sunsetHour - 0.25` to `sunsetHour + 0.25` (15 minutes around sunset)
- **Intensity Threshold**: `> 0.5` (for period determination)
- **Intensity Calculation**: `1.0 - (|currentHour - sunsetHour| / 0.25 * 4)`
- **Peak**: Exactly at `sunsetHour` (intensity = 1.0)
- **Example**: If sunset is at 4:52 PM, sunset period is 4:37 PM - 5:07 PM

### 7. **Dusk**
- **Range**: `sunsetHour` to `sunsetHour + 0.5` (30 minutes after sunset)
- **Intensity Threshold**: `> 0.1` (for period determination)
- **Intensity Calculation**: `(currentHour - sunsetHour) / 0.5`
- **Conditions**:
  - `currentHour > sunsetHour && currentHour <= duskEndHour`
  - `duskIntensity > 0.1`
- **Example**: If sunset is at 4:52 PM, dusk is 4:52 PM - 5:22 PM

### 8. **Night**
- **Range**: After `duskEndHour` until `dawnStartHour` (next day)
- **Conditions**:
  - `sunPhase === 'post-dusk'` OR `sunPhase === 'pre-dawn'`
  - OR `!isDaylight && perceivableLight === 0`
  - AND `currentHour < 22` (before 10pm) OR `midnightIntensity <= 0.7`
- **Example**: If dusk ends at 5:22 PM and dawn starts at 6:22 AM, night is 5:22 PM - 10:00 PM and 4:00 AM - 6:22 AM

### 9. **Midnight**
- **Range**: After 10pm (22:00) until 4am (04:00) or when `distanceToTwilight > 4 hours`
- **Intensity Threshold**: `> 0.7` (for period determination)
- **Conditions**:
  - `sunPhase === 'post-dusk'` OR `sunPhase === 'pre-dawn'`
  - OR `!isDaylight && perceivableLight === 0`
  - AND `currentHour >= 22` (after 10pm)
  - AND `midnightIntensity > 0.7`
- **Midnight Intensity Calculation**:
  - Full intensity (1.0) if `currentHour < 4` OR `currentHour >= 22`
  - Full intensity if `distanceToTwilight > 4.0` hours
  - Otherwise: `1.0 - (distanceToTwilight / 4.0)`
- **Example**: If dusk ends at 5:22 PM, midnight is 10:00 PM - 4:00 AM

## Overlap Handling

Periods are checked in priority order, so if multiple periods could apply:
- **Sunrise/Sunset** take priority over dawn/dusk (15-minute windows checked first)
- **Dawn/Dusk** take priority over golden hour (30-minute windows checked before golden hour)
- **Golden Hour** takes priority over midday (checked before midday)
- **Midday** applies when golden hour intensity is low
- **Night/Midnight** only apply when sun is at 0% (post-dusk or pre-dawn)

## Key Variables

- `sunriseHour`: Calculated sunrise time (decimal hours, e.g., 6.876 = 6:52 AM)
- `sunsetHour`: Calculated sunset time (decimal hours, e.g., 16.876 = 4:52 PM)
- `solarNoon`: Midpoint between sunrise and sunset
- `dawnStartHour`: `sunriseHour - 0.5` (30 minutes before sunrise)
- `duskEndHour`: `sunsetHour + 0.5` (30 minutes after sunset)
- `currentHour`: Current time in decimal hours (e.g., 18.27 = 6:16 PM)
- `isDaylight`: `currentHour >= sunriseHour && currentHour < sunsetHour`
- `sunPhase`: 'pre-dawn', 'rising', 'setting', 'post-dusk', 'polar_day', 'polar_night'
- `perceivableLight`: 0-1 scale, 0 = no light (true night), 1.0 = full daylight

## Notes

- All times are in decimal hours (e.g., 6.5 = 6:30 AM, 18.75 = 6:45 PM)
- Periods are location-specific based on calculated sunrise/sunset times
- Polar conditions (polar day/night) are handled separately
- The system uses 30-minute windows for dawn/dusk (civil twilight)
- The system uses 15-minute windows for sunrise/sunset transitions
- Golden hour uses 90-minute windows (1.5 hours)
- Midday uses ±2 hour windows around solar noon

