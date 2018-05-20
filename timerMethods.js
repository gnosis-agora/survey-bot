import assert from "assert";
import {findAllDocuments, updateActiveSubject, findActiveSubject} from "./mongoMethods";
import moment from "moment";
var MongoClient = require('mongodb').MongoClient;
var url = 'mongodb://heroku_6s2cdsgj:jfu9mmja5pbr23ab1hnl7bsuko@ds135690.mlab.com:35690/heroku_6s2cdsgj';

export const updateLastSeen = (userId) => {
	findActiveSubject(userId).then(doc => {
		if (doc != null) {
			updateActiveSubject({$set: {lastSeen: new moment().unix()}}, userId);
		}
	});
}