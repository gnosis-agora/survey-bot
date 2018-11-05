import express from "express";
import request from "request";
import bodyParser from "body-parser";
import rp from "request-promise";
import https from "https";
import later from "later";
import moment from "moment";
import {updateDocument, findDocument, findAllDocuments, insertDocument} from './mongoMethods';
import {insertActiveSubject, findAllActiveSubjects, updateActiveSubject, findActiveSubject, removeActiveSubject} from "./mongoMethods";
import {getSchedule} from './schedulerHelpers';
import {updateLastSeen} from './timerMethods';
import Chance from "chance";
var chance = new Chance();


setInterval(() => {
  https.get("https://nameless-coast-38025.herokuapp.com/");
}, 900000);

var app = express();
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.listen((process.env.PORT || 5000));

/* Continue operations in the case of forced dyno restart */
findAllActiveSubjects().then(docs => {
  if (docs != null) {
    docs.forEach(userData => {
      findDocument(userData.userId).then(currentUser => {
        repeatMessage(currentUser.userId, currentUser.wakingTime, currentUser.sleepingTime, currentUser.timezone, userData.steps, userData.maxStep, currentUser.lastSentMessageHour);
      });
    });    
  }
});

/* Check for idleness of each subject every minute */
setInterval(() => {
  findAllActiveSubjects().then(docs => {
    if (docs != null) {
      docs.forEach(activeSubject => {
        if ((new moment().unix() - activeSubject.lastSeen >= 60*60) && !activeSubject.idled) {
          // if user is idle for > 20 min
          // set flag so we won't repeatedly prompt idle user
          updateActiveSubject({$set: {idled: true}}, activeSubject.userId);
          // ask idle questions to user
          findDocument(activeSubject.userId).then(doc => {
            let currentUser = doc;
            console.log(JSON.stringify(currentUser));
            currentUser.currentState = 14;
            currentUser.timeStamp = new Date();
            currentUser.dateString = new moment().add(currentUser.timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a");
            updateDocument(currentUser, currentUser._id);
            let question = [
              {
                text: "Oh no! It appears that you've been idle for too long."
              },
              {
                text: "Why didn't you respond to the previous qeustion?"
              },
              {
                text: "A: I didn't have my phone with me.\nB: I had my phone with me, but I didn’t check my phone.\nC: I didn't have Internet access.\nD: I was sleeping.\nE: I was doing something that couldn't be disrupted.\nF: Some other reason",
                quick_replies: [
                  {
                    content_type: "text",
                    title: "A",
                    payload: "I didn't have my phone with me."
                  },
                  {
                    content_type: "text",
                    title: "B",
                    payload: "I had my phone with me, but I didn’t check my phone."
                  },
                  {
                    content_type: "text",
                    title: "C",
                    payload: "I didn't have Internet access."
                  },
                  {
                    content_type: "text",
                    title: "D",
                    payload: "I was sleeping."
                  },
                  {
                    content_type: "text",
                    title: "E",
                    payload: "I was doing something that couldn't be disrupted."
                  },                    
                  {
                    content_type: "text",
                    title: "F",
                    payload: "Others"
                  },  
                ]
              }
            ];
            sendMessage(activeSubject.userId, question);
          });
        }
      });
    }
  });
}, 60000);

/* SET ALL GLOBAL VARIABLES HERE */
const QUESTION_2_ANSWERS = {A: "My boyfriend/girlfriend/partner/spouse", B: "Friends/colleagues/schoolmates", C: "Family", D: "Alone", E: "Others (please specify)"};
const QUESTION_5_ANSWERS = {A: "I was also using my phone.", B: "I was engaged in some other task and didn’t really notice.", C: "The people/person I was with apologised and gave an explanation for phone use.", D: "Others"};
const IDLE_QUESTION_ANSWERS = {A: "I didn't have my phone with me.",B: "I had my phone with me, but I didn’t check my phone.", C: "I didn't have Internet access.", D: "I was sleeping.", E: "I was doing something that couldn't be disrupted.", F: "Some other reason"};

// Server index page
app.get("/", (req, res) => {
  res.send("hello world");
});

// Facebook Webhook
// Used for verification
app.get("/webhook", function (req, res) {
  if (req.query["hub.verify_token"] === process.env.VERIFICATION_TOKEN) {
    console.log("Verified webhook");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    console.error("Verification failed. The tokens do not match.");
    res.sendStatus(403);
  }
});

// All callbacks for Messenger will be POST-ed here
app.post("/webhook", function (req, res) {
  // Make sure this is a page subscription
  if (req.body.object == "page") {
    // Iterate over each entry
    // There may be multiple entries if batched
    req.body.entry.forEach(function(entry) {
      // Iterate over each messaging event
      entry.messaging.forEach(function(event) {
        if (event.postback) {
          processPostback(event);
        } 
        else if (event.message) {
          processMessage(event);
        }
      });
    });
    res.sendStatus(200);
  }
});


function processPostback(event) {
  let senderId = event.sender.id;
  let payload = event.postback.payload;
  if (payload === "Greeting") {
    // Get user's first name from the User Profile API
    // and include it in the greeting
    request({
      url: "https://graph.facebook.com/v2.6/" + senderId,
      qs: {
        access_token: process.env.PAGE_ACCESS_TOKEN,
        fields: "first_name,locale,timezone"
      },
      method: "GET"
    }, function(error, response, body) {
      let greeting = "";
      let locale;
      let timezone;
      if (error) {
        console.log("Error getting user's name: " +  error);
      } else {
        let bodyObj = JSON.parse(body);
        let name = bodyObj.first_name;
        locale = bodyObj.locale;
        timezone = bodyObj.timezone;        
        findActiveSubject(senderId).then(doc => {
          if (doc) {
            greeting = "It appears that you're already registered in this survey. Please wait patiently for the questions to be prompted to you."
          } else {
            greeting = "Hi " + name + ". Please enter your identification number: ";            
            insertDocument({userId: senderId, currentState: 0, locale: locale, timezone: timezone, timeStamp: new Date(), dateString: new moment().add(timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a")});
          }
          sendMessage(senderId, [{text: greeting}]);
        })        
      }
    });
  }
}

function processMessage(event) {
  if (!event.message.is_echo) {
    var message = event.message;
    var senderId = event.sender.id;

    // handle normal messages and question sending here
    // question prompts for a state are always sent from previous state's bracket
    if (message.text) {
      updateLastSeen(senderId);
      findDocument(senderId).then(doc => {
        let currentUser = doc;
        let question;
        switch (currentUser.currentState) {
          case 0:
            currentUser.uniqueId = message.text;
            currentUser.currentState = 1;
            updateDocument(currentUser, currentUser._id);
            sendMessage(senderId, [{text: "What time do you usually wake up? (Please enter in the 24-hour format, HHMM. E.g. 0930)"}]);
            break;

          case 1:
            if (message.text.length != 4 || isNaN(message.text)) {
              sendMessage(senderId, [{text: "Please enter a valid format. E.g. 0930"}]);
            }
            else {
              currentUser.wakingTime = message.text;
              currentUser.currentState = 2;
              updateDocument(currentUser, currentUser._id);
              sendMessage(senderId, [{text: "What time do you usually fall asleep? (Please enter in the 24-hour format, HHMM. E.g. 2230)"}]);
            }
            break;

          case 2:
            if (message.text.length != 4 || isNaN(message.text)) {
              sendMessage(senderId, [{text: "Please enter a valid format. E.g. 2230"}]);
            }
            else {
              currentUser.sleepingTime = message.text;
              currentUser.currentState = -1;
              let getMaxStep = getSchedule(currentUser.wakingTime, currentUser.sleepingTime, currentUser.timezone)['schedules'].length * 7;
              updateDocument(currentUser, currentUser._id);
              insertActiveSubject({userId: senderId, steps: 0, lastSeen: new moment().unix(), idled: true, maxStep: getMaxStep});
              repeatMessage(senderId, currentUser.wakingTime, currentUser.sleepingTime, currentUser.timezone, 0, getMaxStep);
              question = [
                {
                  text: "Thank you for your response. As part of the research study, we will message you a few times a day in the coming week. Please respond in a timely manner; you will need to answer 80% of the prompts to be reimbursed."
                }
              ];
              sendMessage(senderId, question);
            };
            break;

          case 3:
            if (!isNaN(message.text) || parseInt(message.text) > 5 || parseInt(message.text) < 1) {
              currentUser.currentState = 18;
              currentUser.q1 = message.text;
              updateDocument(currentUser, currentUser._id); 
              question = [
                {
                  text: ("In the past 20 minutes, I was with (select all that apply): ")
                },
                {
                  text: "Please select your answers by replying through the chatbox in this format: A,B,C"
                },
                {
                  text: "A: My boyfriend/girlfriend/partner/spouse\nB: Friends/colleagues/schoolmates\nC: Family\nD: Alone\nE: Others" 
                }
              ];
              sendMessage(senderId, question);
            }
            else {
              let question = [
                {
                  text: "Rate this statement: Right now, I feel happy (1 = not at all, 5 = very much so).",
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "1",
                      payload: "1"                   
                    },
                    {
                      content_type: "text",
                      title: "2",
                      payload: "2"                      
                    },
                    {
                      content_type: "text",
                      title: "3",
                      payload: "3"                      
                    },        
                    {
                      content_type: "text",
                      title: "4",
                      payload: "4"                      
                    },     
                    {
                      content_type: "text",
                      title: "5",
                      payload: "5"                      
                    }         
                  ]
                }
              ];
              sendMessage(senderId, question);                
            }
            break;          

          case 4:
            let regex = /^\d+$/;
            if (!regex.test(message.text)) {
              sendMessage(senderId, [{text: "Please enter just a number. How many people were there in total?"}]);
            }
            else {
              // map multiple choice answers to their long answers
              currentUser.q2_people = message.text;
              currentUser.currentState = 5;
              updateDocument(currentUser, currentUser._id);
              question = [
                {
                  text: "Rate your interaction with the person/people you were with: The person/people I was with made me feel (1 = completely excluded, 5 = completely excluded).",
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "1",
                      payload: "Not at all satisfied"
                    },
                    {
                      content_type: "text",
                      title: "2",
                      payload: "Not satisfied"
                    },
                    {
                      content_type: "text",
                      title: "3",
                      payload: "Neutral"
                    },
                    {
                      content_type: "text",
                      title: "4",
                      payload: "Satisfied"
                    },                    
                    {
                      content_type: "text",
                      title: "5",
                      payload: "Extremely Satisfied"
                    },  
                  ]
                }
              ];
              sendMessage(senderId, question);
            }
            break;

          case 5:
            if (!isNaN(message.text) || parseInt(message.text) > 5 || parseInt(message.text) < 1) {
              currentUser.currentState = 6;
              currentUser.q3 = parseInt(message.text);
              updateDocument(currentUser, currentUser._id); 
              question = [
                {
                  text: ("The people/person I was with used their phone."),
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "Yes",
                      payload: "USED_PHONE"
                    },
                    {
                      content_type: "text",
                      title: "No",
                      payload: "DID_NOT_USE_PHONE"
                    } 
                  ]
                }
              ];
              sendMessage(senderId, question);
            }
            else {
              let question = [
                {
                  text: "Rate your interaction with the person/people you were with: The person/people I was with made me feel (1 = completely excluded, 5 = completely excluded).",
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "1",
                      payload: "1"                   
                    },
                    {
                      content_type: "text",
                      title: "2",
                      payload: "2"                      
                    },
                    {
                      content_type: "text",
                      title: "3",
                      payload: "3"                      
                    },        
                    {
                      content_type: "text",
                      title: "4",
                      payload: "4"                      
                    },     
                    {
                      content_type: "text",
                      title: "5",
                      payload: "5"                      
                    }         
                  ]
                }
              ];
              sendMessage(senderId, question);                
            }
            break;

          case 6:
            if (!message.quick_reply.payload) {
              let question = [
                {
                  text: "Please press the buttons instead of typing the reply."
                },
                {
                  text: ("n the past 20 minutes, the people/person I was with ______ their phone"),
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "Used",
                      payload: "USED_PHONE"
                    },
                    {
                      content_type: "text",
                      title: "Did not use",
                      payload: "DID_NOT_USE_PHONE"
                    } 
                  ]
                }
              ];
              sendMessage(senderId, question);
            }
            else if (message.quick_reply.payload === "USED_PHONE") {
              currentUser.currentState = 8;
              currentUser.q4 = message.text;
              updateDocument(currentUser, currentUser._id);
              question = [
                {
                  text: "Which of these were true of your response? (select all that apply)"
                },
                {
                  text: "Please select your answers by replying through the chatbox in this format: A,B,C"
                },
                {
                  text: "A: I was also using my phone.\nB: I was engaged in some other task and didn’t really notice.\nC: The people/person I was with apologised and gave an explanation for phone use\nD: Others" 
                }
              ];
              sendMessage(senderId, question);              
            }
            else {
              currentUser.q4 = message.text;
              currentUser.currentState = 17;
              updateDocument(currentUser, currentUser._id);
              updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again           
              sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
            }
            break;            

          case 7:
            currentUser.q3_extra = message.text;
            currentUser.currentState = 5;
            updateDocument(currentUser, currentUser._id);
            question = [
              {
                text: "Rate your interaction with the person/people you were with: The person/people I was with made me feel (1 = completely excluded, 5 = completely excluded).",
                quick_replies: [
                  {
                    content_type: "text",
                    title: "1",
                    payload: "Not at all satisfied"
                  },
                  {
                    content_type: "text",
                    title: "2",
                    payload: "Not satisfied"
                  },
                  {
                    content_type: "text",
                    title: "3",
                    payload: "Neutral"
                  },
                  {
                    content_type: "text",
                    title: "4",
                    payload: "Satisfied"
                  },                    
                  {
                    content_type: "text",
                    title: "5",
                    payload: "Extremely Satisfied"
                  },  
                ]
              }
            ];
            sendMessage(senderId, question);
            break;

          case 8:
            var regex = /^[a-zA-Z](,[a-zA-Z])*$/;
            if (!regex.test(message.text)) {
              sendMessage(senderId, [{text: "Please select your answers by replying through the chatbox in this format: A,B,C"}]);
            }
            else {
              let answers = message.text.split(',');
              // change all answers to uppercase
              answers = answers.map(ele => ele.toUpperCase());

              if (answers.indexOf("D") != -1) {
                // remove "D" from answers array
                answers = answers.filter(ele => ele !== "D");
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_5_ANSWERS[ele]);
                // move to state 6
                currentUser.currentState = 9;
                currentUser.q5 = answers;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "Please elaborate: "
                  }
                ];
                sendMessage(senderId, question);
              }
              else if (answers.indexOf('A') != -1) {
                // remove "A" from answers array
                answers = answers.filter(ele => ele !== "A");
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_5_ANSWERS[ele]);
                // move to state 6
                currentUser.currentState = 10;
                currentUser.q5 = answers;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "Amongst the people that you were with, were you the first person to use your phone?",
                    quick_replies: [
                      {
                        content_type: "text",
                        title: "Yes",
                        payload: "Yes"
                      },
                      {
                        content_type: "text",
                        title: "No",
                        payload: "No"
                      } 
                    ]
                  }
                ];
                sendMessage(senderId, question);
              }
              else {
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_5_ANSWERS[ele]);
                currentUser.q5 = answers;
                currentUser.currentState = 17;
                updateDocument(currentUser, currentUser._id);
                updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again           
                sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
              }
              
            }
            break;

          case 9:
            currentUser.q5_extra = message.text;
            currentUser.currentState = 17;
            updateDocument(currentUser, currentUser._id);
            updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again           
            sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
            break;

          case 10:
            currentUser.q5_first_person = message.text;
            currentUser.currentState = 17;
            updateDocument(currentUser, currentUser._id);
            updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again           
            sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
            break;

          case 14:
            let answer = message.text.toUpperCase();
            if (answer == "F") {
              currentUser.currentState = 15;
              question = [
                {
                  text: "Please specify: "
                }
              ];
            }
            else {
              currentUser.idleQuestion1 = IDLE_QUESTION_ANSWERS[answer];
              currentUser.currentState = 16;
              question = [
                {
                  text: "When the earlier question was sent, I was: ",
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "Alone",
                      payload: "Alone"
                    },
                    {
                      content_type: "text",
                      title: "With other people",
                      payload: "With other people"
                    },
                    {
                      content_type: "text",
                      title: "Unsure",
                      payload: "Unsure"
                    },
                  ]  
                }
              ]
            }
            updateDocument(currentUser, currentUser._id);
            sendMessage(senderId, question);
            break;

          case 15:
            currentUser.idleQuestion1 = message.text;
            currentUser.currentState = 16;
            question = [
              {
                text: "When the earlier question was sent, I was: ",
                quick_replies: [
                  {
                    content_type: "text",
                    title: "Alone",
                    payload: "Alone"
                  },
                  {
                    content_type: "text",
                    title: "With other people",
                    payload: "With other people"
                  },
                  {
                    content_type: "text",
                    title: "Unsure",
                    payload: "Unsure"
                  },
                ]  
              }
            ];
            updateDocument(currentUser, currentUser._id);
            sendMessage(senderId, question);
            break;

          case 16:
            currentUser.idleQuestion2 = message.text;
            currentUser.currentState = 17;
            updateDocument(currentUser, currentUser._id);
            updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again
            sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
            break;

          case 18:
            var regex = /^[a-zA-Z](,[a-zA-Z])*$/;
            if (!regex.test(message.text)) {
              sendMessage(senderId, [{text: "Please select your answers by replying through the chatbox in this format: A,B,C"}]);
            }
            else {
              let answers = message.text.split(',');
              // change all answers to uppercase
              answers = answers.map(ele => ele.toUpperCase());

              if (answers.indexOf("E") != -1) {
                // remove "E" from answers array
                answers = answers.filter(ele => ele !== "E");
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_2_ANSWERS[ele]);
                // move to state 6
                currentUser.currentState = 7;
                currentUser.q2 = answers;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "Please elaborate: "
                  }
                ];
              }
              else if (answers.indexOf("D") != -1) {
                currentUser.q2 = "D";
                currentUser.currentState = 17;
                updateDocument(currentUser, currentUser._id);
                updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again           
                sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
              }
              else {
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_2_ANSWERS[ele]);
                currentUser.q2 = answers;
                currentUser.currentState = 4;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "How many people were there in total?"
                  }
                ];
              }
              sendMessage(senderId, question);
            }
            break;

        }
      });      
    }
    else if (message.attachments) {
        sendMessage(senderId, [{text: "Sorry, I don't understand your request."}]);
    }  
  }
}

var sendMessage = (recipientId, messages, index=0) => {
  if (index < messages.length) {
    request({
      url: "https://graph.facebook.com/v2.6/me/messages",
      qs: {access_token: process.env.PAGE_ACCESS_TOKEN},
      method: "POST",
      json: {
        recipient: {id: recipientId},
        message: messages[index]
      }
    }, (error, response, body) => {
      if (error) {
        console.log("Error sending message: " + response.error);
      }
      sendMessage(recipientId,messages,index+1);
    });
  }
  else {
    return;
  }  
}

var repeatMessage = (senderId, wakingTime, sleepingTime, timezone, steps, maxStep, lastSentMessage=-1) => {
  if (steps >= maxStep) { // TESTING
    removeActiveSubject(senderId);
    return;
  }
  else {
    let lastSentMessageHour = lastSentMessage;
    let count = 0;
    let schedule = getSchedule(wakingTime, sleepingTime, timezone);
    let t = later.setInterval(() => {
      
      let nowInHours = new moment().hours();
      // check if last message already sent in this hour period
      if (nowInHours != lastSentMessageHour) {
        findDocument(senderId).then(doc => {
          updateLastSeen(senderId); // update last seen time to current time
          updateActiveSubject({$set: {idled: false}}, senderId); // start idle timer
          let currentUser;
          if (doc.currentState == -1) {
            currentUser = doc;
            currentUser.currentState = 3;
            currentUser.timeStamp = new Date();     
            currentUser.dateString = new moment().add(currentUser.timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a");
            currentUser.lastSentMessageHour = new moment().hours();
            updateDocument(currentUser,doc._id);
          }
          else{
            currentUser = {};
            currentUser.userId = senderId;
            currentUser.locale = doc.locale;
            currentUser.timezone = doc.timezone;
            currentUser.uniqueId = doc.uniqueId;
            currentUser.wakingTime = doc.wakingTime;
            currentUser.sleepingTime = doc.sleepingTime;
            currentUser.currentState = 3;
            currentUser.timeStamp = new Date();     
            currentUser.dateString = new moment().add(currentUser.timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a");
            currentUser.lastSentMessageHour = new moment().hours();
            insertDocument(currentUser);
          }
          let question = [
            {
              text: "Rate this statement: Right now, I feel happy (1 = not at all, 5 = very much so).",
              quick_replies: [
                {
                  content_type: "text",
                  title: "1",
                  payload: "1"                   
                },
                {
                  content_type: "text",
                  title: "2",
                  payload: "2"                      
                },
                {
                  content_type: "text",
                  title: "3",
                  payload: "3"                      
                },        
                {
                  content_type: "text",
                  title: "4",
                  payload: "4"                      
                },     
                {
                  content_type: "text",
                  title: "5",
                  payload: "5"                      
                }         
              ]
            }
          ];
          sendMessage(senderId, question);
          lastSentMessageHour = new moment().hours();
          count++;
          if (count >= 1) {
            t.clear();
            updateActiveSubject({$inc: {steps: 1}},senderId);
            repeatMessage(senderId, wakingTime, sleepingTime, timezone, steps + 1, maxStep, lastSentMessageHour);
          }
        });
      }
    }, schedule);
  }
}