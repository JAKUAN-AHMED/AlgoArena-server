const express = require("express");
const cors = require("cors");
require("dotenv").config();
const SSLCommerzPayment = require("sslcommerz-lts");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const axios = require("axios");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());

// Database Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.z5rmhar.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// MongoDB client
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
    const userCollection = client.db("AlgoArena").collection("users");
    const contestCollection = client.db("AlgoArena").collection("contests");
    const paymentCollection = client
      .db("AlgoArena")
      .collection("payment-history");
    // Root endpoint
    app.get("/", (req, res) => {
      res.send("Hello World!");
    });

    // JWT token generation API
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_SECRET_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Add new user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user?.email };
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send({ message: "User Already Exists" });
      } else {
        const result = await userCollection.insertOne(user);
        res.send(result);
      }
    });

    // Get all users
    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // Block User API (Admin only)
    app.patch("/users/:id/toggle-block", async (req, res) => {
      const { id } = req.params;
      const { currentUserID } = req.body; // The admin's ID

      try {
        const currentUser = await userCollection.findOne({
          _id: new ObjectId(currentUserID),
        });

        if (!currentUser || currentUser.role !== "Admin") {
          return res
            .status(403)
            .send({ message: "Only admins can block/unblock users" });
        }

        const userToBlock = await userCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!userToBlock) {
          return res.status(404).send({ message: "User not found" });
        }

        const newBlockStatus = !userToBlock.blocked;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { blocked: newBlockStatus } }
        );

        res.send({
          message: `User ${
            newBlockStatus ? "blocked" : "unblocked"
          } successfully`,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to toggle block" });
      }
    });

    // Admin Role Change (Only one Admin allowed)
    app.patch("/users/:id/role", async (req, res) => {
      const { id } = req.params;
      const { currentUserID, role } = req.body; // Admin ID and new role for the user

      try {
        const currentUser = await userCollection.findOne({
          _id: new ObjectId(currentUserID),
        });

        if (!currentUser || currentUser.role !== "Admin") {
          return res
            .status(403)
            .send({ message: "Only admins can change roles" });
        }

        // If the user is being promoted to Admin, demote current Admin
        if (role === "Admin") {
          const currentAdmin = await userCollection.findOne({ role: "Admin" });

          if (currentAdmin) {
            await userCollection.updateOne(
              { _id: currentAdmin._id },
              { $set: { role: "User" } }
            );
          }
        }

        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        if (result.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "User not found or role already set" });
        }

        res.send({ message: `User role successfully changed to ${role}` });
      } catch (error) {
        res.status(500).send({ message: "Failed to change user role" });
      }
    });

    // Delete User API (Admin only)
    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;
      const { currentUserID } = req.body; // Admin ID

      try {
        const currentUser = await userCollection.findOne({
          _id: new ObjectId(currentUserID),
        });

        if (!currentUser || currentUser.role !== "Admin") {
          return res
            .status(403)
            .send({ message: "Only admins can delete users" });
        }

        const result = await userCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send({ message: "User successfully deleted" });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete user" });
      }
    });

    //contest api
    app.post("/contests", async (req, res) => {
      const contest = req.body;
      const result = await contestCollection.insertOne(contest);
      res.send(result);
    });

    //get contest api
    app.get("/contests", async (req, res) => {
      const result = await contestCollection.find().toArray();
      res.send(result);
    });

    //get data for single creator
    app.get("/contests/email", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await contestCollection.find(query).toArray();
      res.send(result);
    });

    // Get top three contest creators
    app.get("/top-creators", async (req, res) => {
      const result = await contestCollection
        .aggregate([
          {
            $group: {
              _id: "$email", // Group by email
              totalContests: { $sum: 1 }, // Count contests
              totalParticipants: { $sum: "$participant" }, // Sum of participants
              recentContest: { $last: "$contestName" }, // Last contest created
              authorImage: { $last: "$contestImage" }, // Last image (can be replaced with a static avatar service if unavailable)
            },
          },
          { $sort: { count: -1 } },
          { $limit: 3 },
        ])
        .toArray();
      res.send(result);
    });

    app.put("/contests/update/:id", async (req, res) => {
      const id = req.params.id;
      const contest = req.body;
      const {
        contestName,
        contestImage,
        contestDescription,
        tag,
        prizeMoney,
        entryFee,
        submissionInstructions,
      } = contest;
      const result = await contestCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            contestName,
            contestImage,
            contestDescription,
            tag,
            prizeMoney,
            entryFee,
            submissionInstructions,
          },
        }
      );
      res.send(result);
    });

   app.patch("/contests/confirm/:id", async (req, res) => {
     const id = req.params.id;
     const result = await contestCollection.updateOne(
       { _id: new ObjectId(id) },
       { $set: { status: "success" } }
     );

     res.send(result);
   });


    //contest delete
    app.delete("/contests/delete/:id", async (req, res) => {
      const deleteContest = await contestCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(deleteContest);
    });

    const store_id = process.env.DB_SSL_STORE_ID;
    const store_passwd = process.env.DB_SSL_STORE_PASSWORD;
    const is_live = false; //true for live, false for sandbox

    //payment-history api
    app.post("/payment-history", async (req, res) => {
      const { name, email, email1, contestId, entryFee } = req.body;
      let Id =ObjectId.createFromHexString(contestId);
      console.log('Id',Id);
      const contest = await contestCollection.findOne(Id);
      const tran_id = new ObjectId().toString();

      const data = {
        total_amount: contest?.entryFee,
        currency: "BDT",
        tran_id: tran_id, // use unique tran_id for each api call
        success_url: `http://localhost:5000/payment/success/${tran_id}`,
        fail_url: ` http://localhost:5000/payment/fail/${tran_id}`,
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: name,
        cus_email: email,
        cus_add1: "Dhaka",
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: "01711111111",
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz.init(data).then((apiResponse) => {
        // Redirect the user to payment gateway
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });
        const payInfo = {
          name,
          email,
          author: email1,
          transactionId: tran_id,
          status: "pending",
          entryFee,
          contestId,
          contestName: contest?.contestName,
        };
        const result = paymentCollection.insertOne(payInfo);
      });

      //payment-success
      app.post("/payment/success/:tranId", async (req, res) => {
        console.log("id", req.params.tranId);
        const contest_Id=await paymentCollection.findOne({transactionId:req.params.tranId});
        console.log("contest id",contest_Id.contestId);
        const result = await paymentCollection.updateOne(
          {
            transactionId: req.params.tranId,
          },
          { $set: { status: "success" } }
        );
        if (result.modifiedCount > 0) {
          const result = await contestCollection.updateOne(
            { _id:ObjectId.createFromHexString(contest_Id.contestId) },
            {
              $inc: { participant: 1 },
            }
          );
          res.redirect(
            `http://localhost:5173/payment/success/${req.params.tranId}`
          );
        }
      });
      //payement-fail
      app.post("/payment/fail/:tranId", async (req, res) => {
        const result = await paymentCollection.deleteOne({
          transactionId: req.params.tranId,
        });
        if (result.modifiedCount > 0) {
          res.redirect(
            `http://localhost:5173/payment/fail/${req.params.tranId}`
          );
        }
      });
    });

    //get payment history data
    app.get("/payment-history", async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    //submit task
    // Route to get payment history by _id (optional, if needed)
    // app.get("/payment-history/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await paymentCollection.findOne(query);
    //   res.send(result);
    // });

    // Route to update payment by transactionId
    app.patch("/payment-history/:transactionId", async (req, res) => {
      const {transactionId } = req.params;
      console.log("transaction", transactionId);
      const { pdfLink } = req.body;
      console.log(pdfLink);
      const query={transactionId:transactionId};
      const result=await paymentCollection.findOne(query);
      console.log(result._id);

      const result1 = await paymentCollection.updateOne(
        { _id: result._id },
        { $set: { pdfLink: pdfLink } }
      );
      const result3=await paymentCollection.findOne(query)
      console.log(result3);
      res.send(result1);
    });

    // search in banner
    app.get("/search", async (req, res) => {
      const { query } = req.query; // Extract query parameter from URL

      // If no query is provided, send an error response
      if (!query) {
        return res.status(400).json({ error: "Search query is required" });
      }

      try {
        // Perform the search query in the MongoDB collection
        const contests = await contestCollection
          .find({
            tag: { $regex: query, $options: "i" }, // Case-insensitive search on tags
          })
          .toArray(); // Convert the result to an array

        // Send the contests as response
        res.json(contests);
      } catch (error) {
        console.error("Error fetching contests:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    // Get submitted payment-info by user email
    app.get("/payment-history/emailData/email", async (req, res) => {
      const email = req.query?.email;
      console.log(email);
      const query = { author: email };
      const paymentHistory = await paymentCollection.find(query).toArray();
      res.send(paymentHistory);
    });
  } finally {
    // Close connection when the application ends
    // await client.close();
  }
}

run().catch(console.dir);

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
