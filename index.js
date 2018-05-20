require('newrelic');
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
  https.get("https://protected-island-32642.herokuapp.com/");
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
        repeatMessage(currentUser.userId,currentUser.wakingTime, currentUser.sleepingTime, currentUser.timezone, userData.steps, currentUser.lastSentMessageHour);
      });
    });    
  }
});

/* Check for idleness of each subject every minute */
setInterval(() => {
  findAllActiveSubjects().then(docs => {
    if (docs != null) {
      docs.forEach(activeSubject => {
        if ((new moment().unix() - activeSubject.lastSeen >= 20*60) && !activeSubject.idled) {
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
                text: "A: I didn't have my phone with me.\nB: I didn't have Internet access.\nC: I was sleeping.\nD: I was doing something that couldn't be disrupted.\nE: I didn't check my phone.\nF: Some other reason (Please specify)",
                quick_replies: [
                  {
                    content_type: "text",
                    title: "A",
                    payload: "I didn't have my phone with me."
                  },
                  {
                    content_type: "text",
                    title: "B",
                    payload: "I didn't have Internet access."
                  },
                  {
                    content_type: "text",
                    title: "C",
                    payload: "I was sleeping."
                  },
                  {
                    content_type: "text",
                    title: "D",
                    payload: "I was doing something that couldn't be disrupted."
                  },                    
                  {
                    content_type: "text",
                    title: "E",
                    payload: "I didn't check my phone."
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
const QUESTION_1_ANSWERS = {A: "SMS (Short Message Service) / iMessage", B: "Whatsapp", C: "WeChat", D: "Snapchat", E: "Facebook Messenger", F: "Line"};
const QUESTION_3_ANSWERS = getQuestion3Choices();
const QUESTION_4_ANSWERS = {A: "Emojis", B: "Short-cuts in spelling (e.g. LOL, b4, l8)", C: "Short-cuts in grammar (e.g. missing words)", D: "Others (Please specify)", E: "No textspeak was used"};
const IDLE_QUESTION_ANSWERS = {A: "I didn't have my phone with me.", B: "I didn't have Internet access.", C: "I was sleeping.", D: "I was doing something that couldn't be disrupted.",E: "I didn't check my phone.", F: "Some other reason (Please specify)"};

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
        greeting = "Hi " + name + ". Please enter your identification number: ";
      }
      sendMessage(senderId, [{text: greeting}]);
      insertDocument({userId: senderId, currentState: 0, locale: locale, timezone: timezone, timeStamp: new Date(), dateString: new moment().add(timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a")});
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
              updateDocument(currentUser, currentUser._id);
              insertActiveSubject({userId: senderId, steps: 0, lastSeen: new moment().unix(), idled: true});
              repeatMessage(senderId,currentUser.wakingTime, currentUser.sleepingTime, currentUser.timezone,0);
              question = [
                {
                  text: "Thank you for your response. As part of the research study, we will message you 7 times a day in the coming week. Please respond in a timely manner; you will need to answer 80% of the prompts to be reimbursed."
                }
              ];
              sendMessage(senderId, question);
            };
            break;

          case 3:
            switch (message.text.toUpperCase()) {
              case ("A"):
                let father = chance.bool();
                currentUser.textFromParents = 2;
                currentUser.currentState = 5;
                currentUser.fromFather = father;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: ("We're going to ask you about your conversation with both parents. Let's start with your " + ((father) ? "father. " : "mother. ")
                          + "What platform did you receive the message(s) on? (Select all that apply)")
                  },
                  {
                    text: "Please select your answers by replying through the chatbox in this format: A,B,C"
                  },
                  {
                    text: "A: SMS (Short Message Service) / iMessage\nB: Whatsapp\nC: WeChat\nD: Snapchat\nE: Facebook Messenger\nF: Line\nG: Others (please specify)" 
                  }
                ];
                sendMessage(senderId, question);
                break;                   
              case ("B"):
                currentUser.textFromParents = 1;
                currentUser.currentState = 4;
                updateDocument(currentUser, currentUser._id); 
                question = [
                  {
                    text: "Please select the parent you received the text message from: ",
                    quick_replies: [
                      {
                        content_type: "text",
                        title: "Father",
                        payload: "STATE_4_A"
                      },
                      {
                        content_type: "text",
                        title: "Mother",
                        payload: "STATE_4_B"                        
                      }
                    ]
                  }
                ];
                sendMessage(senderId, question);
                break;
              case ("C"):
                currentUser.currentState = 17;
                updateDocument(currentUser, currentUser._id);
                updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again
                sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
                break;

              default:
                let question = [
                  {
                    text: "It appears that you've selected an invalid option."
                  },
                  {
                    text: "In the past 30 minutes, did you receive at least 1 text message from your parent(s)?"
                  },
                  {
                    text: "A. Yes, from both parents. \nB. Yes, from one parent \nC. No",
                    quick_replies: [
                      {
                        content_type: "text",
                        title: "A",
                        payload: "STATE_3_A"                   
                      },
                      {
                        content_type: "text",
                        title: "B",
                        payload: "STATE_3_B"                      
                      },
                      {
                        content_type: "text",
                        title: "C",
                        payload: "STATE_3_C"                      
                      },                    
                    ]
                  }
                ];
                sendMessage(senderId, question);
                break;
            }
            break;

          case 4:
            currentUser.currentState = 5;
            currentUser.fromFather = (message.text === "Father") ? true : false;
            updateDocument(currentUser, currentUser._id);
            question = [
              {
                text: ("We're going to ask you about your conversation with your " + message.text + ". What platform did you receive the message(s) on? (Select all that apply)")
              },
              {
                text: "Please select your answers by replying through the chatbox in this format: A,B,C"
              },
              {
                text: "A: SMS (Short Message Service) / iMessage\nB: Whatsapp\nC: WeChat\nD: Snapchat\nE: Facebook Messenger\nF: Line\nG: Others (please specify)" 
              }
            ];
            sendMessage(senderId, question);
            break;            

          case 5:
            let regex = /^[a-zA-Z](,[a-zA-Z])*$/;
            if (!regex.test(message.text)) {
              sendMessage(senderId, [{text: "Please select your answers by replying through the chatbox in this format: A,B,C"}]);
            }
            else {
              let answers = message.text.split(',');
              // change all answers to uppercase
              answers = answers.map(ele => ele.toUpperCase());

              if (answers.indexOf("G") != -1) {
                // remove "G" from answers array
                answers = answers.filter(ele => ele !== "G");
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_1_ANSWERS[ele]);
                // move to state 6
                currentUser.currentState = 6;
                currentUser.question1 = answers;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "Please specify the platform: "
                  }
                ];
              }
              else {
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_1_ANSWERS[ele]);
                currentUser.question1 = answers;
                currentUser.currentState = 7;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "Were you satisfied with the conversation?"
                  },
                  {
                    text: "On a scale of 1-5, with '1' being Not At All Satisfied and '5' being Extremely Satisfied, how satisfied were you with the conversation?",
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
              }
              sendMessage(senderId, question);
            }
            break;

          case 6:
            currentUser.currentState = 7;
            currentUser.question1.push(message.text);
            updateDocument(currentUser, currentUser._id);
            question = [
              {
                text: "Were you satisfied with the conversation?"
              },
              {
                text: "On a scale of 1-5, with '1' being Not At All Satisfied and '5' being Extremely Satisfied, how satisfied were you with the conversation?",
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

          case 7:
            currentUser.currentState = 8;
            currentUser.question2 = message.text;
            updateDocument(currentUser, currentUser._id);
            question = [
              {
                text: ("On a scale of 1-5, with '1' being Not at all cool and '5' being Extremely cool, rate how cool you think your parent is.")
                quick_replies: [
                  {
                    content_type: "text",
                    title: "1",
                    payload: "Not at all cool"
                  },
                  {
                    content_type: "text",
                    title: "2",
                    payload: "Not cool"
                  },
                  {
                    content_type: "text",
                    title: "3",
                    payload: "Neutral"
                  },
                  {
                    content_type: "text",
                    title: "4",
                    payload: "Cool"
                  },                    
                  {
                    content_type: "text",
                    title: "5",
                    payload: "Extremely cool"
                  }, 
              }
            ];
            sendMessage(senderId, question);
            break;            

          case 8:
            currentUser.currentState = 9;
            currentUser.question3 = message.text;;
            updateDocument(currentUser, currentUser._id);
            question = [
              {
                text: ("Did your parent use any of the following 'textspeak' features? (Select all that apply)")
              },
              {
                text: "Please select your answers by replying through the chatbox in this format: A,B,C"
              },
              {
                text: ("A: " + QUESTION_4_ANSWERS["A"] + "\n" +
                      "B: " + QUESTION_4_ANSWERS["B"] + "\n" + 
                      "C: " + QUESTION_4_ANSWERS["C"] + "\n" +
                      "D: " + QUESTION_4_ANSWERS["D"] + "\n" + 
                      "E: " + QUESTION_4_ANSWERS["E"] + "\n"     
                      )             
              }
            ];
            sendMessage(senderId, question);
            break;

          case 9:
            regex = /^[a-zA-Z](,[a-zA-Z])*$/;
            if (!regex.test(message.text)) {
              sendMessage(senderId, [{text: "Please select your answers by replying through the chatbox in this format: A,B,C"}]);
            }
            else {
              let answers = message.text.split(',');
              // change all answers to uppercase
              answers = answers.map(ele => ele.toUpperCase());

              if (answers.indexOf("E") != -1) {
                // case where no textspeak was used, exit
                currentUser.question4 = [];
                currentUser.currentState = 17;
                if (currentUser.textFromParents == 2) {
                  updateDocument(currentUser, currentUser._id);
                  let newUser = Object.assign({}, currentUser);
                  newUser.textFromParents = 1;
                  newUser.currentState = 5;
                  question = [
                    {
                      text: ("We're going to ask you about your conversation with your " 
                        + ((currentUser.fromFather) ? "mother" : "father")
                        + ". What platform did you receive the message(s) on? (Select all that apply)")
                    },
                    {
                      text: "Please select your answers by replying through the chatbox in this format: A,B,C"
                    },
                    {
                      text: "A: SMS (Short Message Service) / iMessage\nB: Whatsapp\nC: WeChat\nD: Snapchat\nE: Facebook Messenger\nF: Line\nG: Others (please specify)" 
                    }
                  ];           
                  newUser.fromFather = !currentUser.fromFather; 
                  newUser.timeStamp = new Date();     
                  newUser.dateString = new moment().add(currentUser.timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a");                       
                  insertDocument(newUser);
                  sendMessage(senderId, question);
                }
                else {
                  updateDocument(currentUser, currentUser._id);
                  updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again
                  sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
                }
                break;
              }
              else if (answers.indexOf("D") != -1) {
                // remove "D" from answers array
                answers = answers.filter(ele => ele !== "D");
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_4_ANSWERS[ele]);
                // move to state 6
                currentUser.currentState = 10;
                currentUser.question4 = answers;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "You selected D: Others. What textspeak feature did your parent use?"
                  }
                ];
              }
              else {
                // map multiple choice answers to their long answers
                answers = answers.map(ele => QUESTION_4_ANSWERS[ele]);
                currentUser.question4 = answers;
                currentUser.currentState = 11;
                updateDocument(currentUser, currentUser._id);
                question = [
                  {
                    text: "In this conversation, my parents used text-speak correctly (like how I would use textspeak myself)"
                  },
                  {
                    text: "On a scale of 1-5, with '1' being 'Strongly Disagree' and '5' being 'Strongly Agree', how much do you agree with this statement?",
                    quick_replies: [
                      {
                        content_type: "text",
                        title: "1",
                        payload: "Strongly Disagree"
                      },
                      {
                        content_type: "text",
                        title: "2",
                        payload: "Disagree"
                      },
                      {
                        content_type: "text",
                        title: "3",
                        payload: "Neutral"
                      },
                      {
                        content_type: "text",
                        title: "4",
                        payload: "Agree"
                      },                    
                      {
                        content_type: "text",
                        title: "5",
                        payload: "Strongly Agree"
                      },  
                    ]
                  }
                ];               
              }
              sendMessage(senderId, question);
            }
            break;

          case 10:
            currentUser.currentState = 11;
            currentUser.question4.push(message.text);
            updateDocument(currentUser, currentUser._id);
            question = [
              {
                text: "In this conversation, my parents used text-speak correctly (like how I would use textspeak myself)"
              },
              {
                text: "On a scale of 1-5, with '1' being 'Strongly Disagree' and '5' being 'Strongly Agree', how much do you agree with this statement?",
                quick_replies: [
                  {
                    content_type: "text",
                    title: "1",
                    payload: "Strongly Disagree"
                  },
                  {
                    content_type: "text",
                    title: "2",
                    payload: "Disagree"
                  },
                  {
                    content_type: "text",
                    title: "3",
                    payload: "Neutral"
                  },
                  {
                    content_type: "text",
                    title: "4",
                    payload: "Agree"
                  },                    
                  {
                    content_type: "text",
                    title: "5",
                    payload: "Strongly Agree"
                  },  
                ]
              }
            ];
            sendMessage(senderId, question);
            break;

          case 11:
            currentUser.question5 = message.text;
            if (message.text === "4" || message.text === "5") {
              currentUser.currentState = 12;
              question = [
                {
                  text: "You selected 'Agree' or 'Strongly Agree'. Please explain the reason for this choice: "
                }
              ]
            }
            else {
              currentUser.currentState = 13;
              question = [
                {
                  text: "In this conversation, I appreciated my parent's use of textspeak"
                },
                {
                  text: "On a scale of 1-5, with '1' being 'Strongly Disagree' and '5' being 'Strongly Agree', how much do you agree with this statement?",
                  quick_replies: [
                    {
                      content_type: "text",
                      title: "1",
                      payload: "Strongly Disagree"
                    },
                    {
                      content_type: "text",
                      title: "2",
                      payload: "Disagree"
                    },
                    {
                      content_type: "text",
                      title: "3",
                      payload: "Neutral"
                    },
                    {
                      content_type: "text",
                      title: "4",
                      payload: "Agree"
                    },                    
                    {
                      content_type: "text",
                      title: "5",
                      payload: "Strongly Agree"
                    },  
                  ]
                }
              ];
            }
            updateDocument(currentUser, currentUser._id);
            sendMessage(senderId, question);
            break;

          case 12:
            currentUser.question5Explanation = message.text;
            currentUser.currentState = 13;
            question = [
              {
                text: "In this conversation, I appreciated my parent's use of textspeak"
              },
              {
                text: "On a scale of 1-5, with '1' being 'Strongly Disagree' and '5' being 'Strongly Agree', how much do you agree with this statement?",
                quick_replies: [
                  {
                    content_type: "text",
                    title: "1",
                    payload: "Strongly Disagree"
                  },
                  {
                    content_type: "text",
                    title: "2",
                    payload: "Disagree"
                  },
                  {
                    content_type: "text",
                    title: "3",
                    payload: "Neutral"
                  },
                  {
                    content_type: "text",
                    title: "4",
                    payload: "Agree"
                  },                    
                  {
                    content_type: "text",
                    title: "5",
                    payload: "Strongly Agree"
                  },  
                ]
              }
            ];            
            updateDocument(currentUser, currentUser._id);
            sendMessage(senderId, question);
            break;

          case 13:
            currentUser.question6 = message.text;
            currentUser.currentState = 17;   
            if (currentUser.textFromParents == 2) {
              updateDocument(currentUser, currentUser._id);
              let newUser = Object.assign({}, currentUser);
              newUser.textFromParents = 1;
              newUser.currentState = 5;
              question = [
                {
                  text: ("We're going to ask you about your conversation with your " 
                    + ((currentUser.fromFather) ? "mother" : "father")
                    + ". What platform did you receive the message(s) on? (Select all that apply)")
                },
                {
                  text: "Please select your answers by replying through the chatbox in this format: A,B,C"
                },
                {
                  text: "A: SMS (Short Message Service) / iMessage\nB: Whatsapp\nC: WeChat\nD: Snapchat\nE: Facebook Messenger\nF: Line\nG: Others (please specify)" 
                }
              ];           
              newUser.fromFather = !currentUser.fromFather;
              newUser.timeStamp = new Date();          
              newUser.dateString = new moment().add(currentUser.timezone,'hours').format("dddd, MMMM Do YYYY, h:mm:ss a");                    
              insertDocument(newUser);
              sendMessage(senderId, question);
            }       
            else {
              updateDocument(currentUser, currentUser._id);   
              updateActiveSubject({$set: {idled: true}}, currentUser.userId); // set idled to true so that we can prompt idle user again           
              sendMessage(senderId, [{text: "Thank you for your feedback!"}]);
            }
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

var repeatMessage = (senderId, wakingTime, sleepingTime, timezone, steps, lastSentMessage=-1) => {
  if (steps >= 35) { // TESTING
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
              text: "In the past 30 minutes, did you receive at least 1 text message from your parent(s)?"
            },
            {
              text: "A. Yes, from both parents. \nB. Yes, from one parent \nC. No",
              quick_replies: [
                {
                  content_type: "text",
                  title: "A",
                  payload: "STATE_3_A"                   
                },
                {
                  content_type: "text",
                  title: "B",
                  payload: "STATE_3_B"                      
                },
                {
                  content_type: "text",
                  title: "C",
                  payload: "STATE_3_C"                      
                },                    
              ]
            }
          ];
          sendMessage(senderId, question);
          lastSentMessageHour = new moment().hours();
          count++;
          if (count >= 1) {
            t.clear();
            updateActiveSubject({$inc: {steps: 1}},senderId);
            repeatMessage(senderId, wakingTime, sleepingTime, timezone, steps + 1, lastSentMessageHour);
          }
        });
      }
    }, schedule);
  }
}