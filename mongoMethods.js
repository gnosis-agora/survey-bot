import assert from "assert";
var MongoClient = require('mongodb').MongoClient;
var url = 'mongodb://heroku_tw9960pt:d94oep26307tq2eup7k0vhcuu@ds213338.mlab.com:13338/heroku_tw9960pt';

export const insertDocument = (data) => {
  delete data._id;
  MongoClient.connect(url, (err, db) => {
    assert.equal(null, err);
    db.collection('testSubjects').insertOne( data , function(err, result) { 
      assert.equal(err, null);
      console.log("Inserted a document into the testSubjects collection.");
    });
    db.close();
  });
};

export const updateDocument = (data, userId) => {
  MongoClient.connect(url , (err, db) => {
    assert.equal(null,err);
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
    assert.equal(null,err);
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
    assert.equal(null,err);
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
    assert.equal(null,err);
    db.collection('activeSubjects').deleteOne({userId: id});
    db.close();
  });
}