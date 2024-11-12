const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { default: axios } = require("axios");

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

    // POST: Initialize payment
    app.post("/initiate-payment", async (req, res) => {
      const { name, email, contestId,email1,entryFee } = req.body;
      const transactionID = `TRANS_${Date.now()}`;
      const paymentData = {
        store_id: process.env.DB_SSL_STORE_ID,
        store_passwd: process.env.DB_SSL_STORE_PASSWORD,
        total_amount: entryFee,
        currency: "BDT",
        tran_id: transactionID,
        success_url: `${process.env.DB_SERVER_URL}/payment-success`,
        fail_url: `${process.env.DB_SERVER_URL}/payment-failure`,
        cancel_url: `${process.env.DB_SERVER_URL}/payment-cancelled`,
        cus_name: name,
        cus_email: email,
        cus_phone: "0123456789",
      };

      try {
        const response = await axios.post(
          `${process.env.DB_SSL_BASE_URL}/initiate`,
          paymentData
        );
        const { GatewayPageURL } = response.data;

        await paymentCollection.insertOne({
          name,
          email,
          transaction_id: transactionID,
          contestId,
          author:email1,
          status: "Pending",
        });

        res.json({ url: GatewayPageURL });
      } catch (error) {
        console.error("Payment initiation error:", error);
        res.status(500).json({ error: "Error initiating payment" });
      }
    });

    // Payment success route
    app.post("/payment-success", async (req, res) => {
      const { tran_id } = req.body;

      await paymentCollection.updateOne(
        { transaction_id: tran_id },
        { $set: { status: "Success" } }
      );

      res.redirect(`${process.env.DB_FRONTEND_URL}/payment-status?status=success`);
    });

    // Payment failure route
    app.post("/payment-failure", async (req, res) => {
      const { tran_id } = req.body;

      await paymentCollection.updateOne(
        { transaction_id: tran_id },
        { $set: { status: "Failed" } }
      );

      res.redirect(`${process.env.FRONTEND_URL}/payment-status?status=failure`);
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
