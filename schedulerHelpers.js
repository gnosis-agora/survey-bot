import Chance from "chance";
var chance = new Chance();



export var getSchedule = (wakingTime, sleepingTime, timezone) => {
	let wakingHours = +wakingTime.substring(0,2);
	let wakingMinutes = +wakingTime.substring(2,4);
	let sleepingHours = +sleepingTime.substring(0,2);
	let sleepingMinutes = +sleepingTime.substring(2,4);

	let specialTiming = [9,11,13,15,17,19,21]
	let finalHour = (sleepingHours - 1 > 12) ? (sleepingHours) : (23);
	let interval = 3;

	let filteredList = specialTiming.filter((hour) => {
		return hour >= wakingHours + 1;
	});

	let schedule = filteredList.map((hour) => {
		if (hour - timezone < 0) {
			return {h : [(hour + 24 - timezone) % 24]}
		}
		else {
			return {h: [(hour-timezone) % 24]}
		}
		
	})

	schedule[0].m = [chance.integer({min: Math.max(wakingMinutes,30), max: 59})];
	for (let i=0;i<schedule.length-1;i++) {
		schedule[i+1].m = [chance.integer({min: 30, max: 59})];
	}
	
	let schedules = {
		schedules: schedule
	};
	console.log(JSON.stringify(schedules));
	return schedules;
}

