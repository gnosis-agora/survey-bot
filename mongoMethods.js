import assert from "assert";
var MongoClient = require('mongodb').MongoClient;
var url = 'mongodb://heroku_5drrr3s0:eds67n6gitdae4q1urh5o1ai5k@ds131954.mlab.com:31954/heroku_5drrr3s0';

export const insertDocument = (data) => {
  delete data._id;
  MongoClient.connect(url, (err, db) => {
    if (err) {
      console.log(err);
    }
    db.collection('testSubjects').insertOne( data , function(err, result) { 
      assert.equal(err, null);
      console.log("Inserted a document into the testSubjects collection.");
    });
    db.close();
  });
};

export const updateDocument = (data, userId) => {
  MongoClient.connect(url , (err, db) => {
    if (err) {
      console.log(err);
    }
    db.collection('testSubjects').update(
      {_id : userId},
      data,
      {upsert: true}
    );
    db.close();
  });
};

export const findDocument = async (userId) => {
  let doc;
  const db = await MongoClient.connect(url);
  let docs = await db.collection('testSubjects').find({userId: userId}).sort({timeStamp: -1}).toArray();
  doc = docs[0];
  return doc;
}

export const findAllDocuments = async () => {
  const db = await MongoClient.connect(url);  
  let docs = await db.collection('testSubjects').find({}).toArray();
  return docs;
}

export const insertActiveSubject = (data) => {
  delete data._id;
  MongoClient.connect(url, (err, db) => {
    if (err) {
      console.log(err);
    }
    db.collection('activeSubjects').insertOne( data, (err, result) => {
      assert.equal(err, null);
      console.log("Inserted a document into the activeSubjects collection.");
    });
    db.close();
  });
}

export const findAllActiveSubjects = async () => {
  const db = await MongoClient.connect(url);
  let docs = await db.collection('activeSubjects').find({}).toArray();
  return docs;
}

export const findActiveSubject = async (userId) => {
  let doc;
  const db = await MongoClient.connect(url);
  doc = await db.collection('activeSubjects').findOne({userId: userId});
  return doc;
}


export const updateActiveSubject = (data, id) => {
  MongoClient.connect(url , (err, db) => {
    if (err) {
      console.log(err);
    }
    db.collection('activeSubjects').update(
      {userId : id},
      data
    );
    db.close();
  });
};

export const removeActiveSubject = (id) => {
  let doc;
  MongoClient.connect(url, (err, db) => {
    if (err) {
      console.log(err);
    }
    db.collection('activeSubjects').deleteOne({userId: id});
    db.close();
  });
}