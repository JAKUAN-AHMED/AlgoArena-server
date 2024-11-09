const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt=require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require("mongodb");

const app=express();
const port=process.env.PORT || 5000;

//midlewares
app.use(express.json());
app.use(cors())



//database
const uri =
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.z5rmhar.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const userCollection=client.db('AlgoArena').collection('users');

    app.get('/',(req,res)=>{
        res.send('hello world!')
    })
    //jwt api
    app.post('/jwt',async(req,res)=>{
        const user=req.body
        const token=jwt.sign(user,process.env.ACCESS_SECRET_TOKEN,{
            expiresIn:'1h',
        })
        // console.log('token generated = ',token);
        res.send({token})
    })


    // all users api
    app.post('/users',async(req,res)=>{
        const user=req.body;
        const result=await userCollection.insertOne(user);
        res.send(result);
    })

    //get users
    app.get('/users',async(req,res)=>{
        const result=await userCollection.find().toArray();
        res.send(result);
    })

    console.log(
      "You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.listen(port,()=>{
    console.log(`server is running on port ${port}`);
})