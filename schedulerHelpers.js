import Chance from "chance";
var chance = new Chance();

export var getSchedule = (wakingTime, sleepingTime, timezone) => {
	let wakingHours = +wakingTime.substring(0,2);
	let wakingMinutes = +wakingTime.substring(2,4);
	let sleepingHours = +sleepingTime.substring(0,2);
	let sleepingMinutes = +sleepingTime.substring(2,4);

	let currHour = wakingHours + 1;
	let finalHour = (sleepingHours - 1 > 12) ? (sleepingHours) : (23);
	let interval = 3;


	let schedule = [];
	while (currHour < finalHour) {
		if (currHour + interval - timezone < 0) {
			schedule.push({h: [(currHour + 24 - timezone) % 24]})
		} else {
			schedule.push({h: [(currHour - timezone) % 24]})
		}
		currHour += interval;
	}

	schedule[0].m = [chance.integer({min: wakingMinutes, max: 59})];
	for (let i=0;i<schedule.length-1;i++) {
		schedule[i+1].m = [chance.integer({min: 0, max: 59})];
	}
	
	let schedules = {
		schedules: schedule
	};
	console.log(JSON.stringify(schedules));
	return schedules;
}

