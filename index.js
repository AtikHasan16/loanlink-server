const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 5000;

// firebase admin setup
var admin = require("firebase-admin");
var serviceAccount = require("./loan-link-admin-token.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// mongodb setup
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const e = require("express");
// Connection URI
const uri = process.env.MONGODB_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// verify firebase token middleware

const verifyFirebaseToken = async (req, res, next) => {
  // Get the token from the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  try {
    const idToken = authHeader.split(" ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    console.log("decoded token", decodedToken);
    req.decodedEmail = decodedToken.email;
  } catch (error) {}
  next();
};

app.get("/", (req, res) => {
  res.send("Server is running");
});

const database = client.db("LoanLink");
const usersCollection = database.collection("users");
const loansCollection = database.collection("loans");
const applicationCollection = database.collection("applications");
const paymentInfoCollection = database.collection("payment_info");
// MongoDB connection
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //******* Stripe payment integration ********

    // Checkout API
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.amount) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.loanTitle,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.customerEmail,
        mode: "payment",
        metadata: {
          loanId: paymentInfo.loanId,
          loanTitle: paymentInfo.loanTitle,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-failed`,
      });
      console.log(session);
      res.send({ url: session.url });
    });

    // after checkout Retrieve API
    app.patch("/payment-success", async (req, res) => {
      const querySession = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(querySession);

      const transactionId = session.payment_intent;
      const query = { transactionId: transactionId };
      const paymentExist = await paymentInfoCollection.findOne(query);
      if (paymentExist) {
        return res.send({
          message: "payment info is trying to inject multiple time",
          transactionId,
        });
      }
      console.log(session);
      if (session.payment_status === "paid") {
        const id = session.metadata.loanId;
        const query = { _id: new ObjectId(id) };
        const update = {
          $set: {
            paymentStatus: "paid",
            transactionId: session.payment_intent,
          },
        };
        const result = await applicationCollection.updateOne(query, update);
        const paymentHistory = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          loanId: session.metadata.loanId,
          loanTitle: session.metadata.loanTitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date().toLocaleString(),
        };

        const resultPayment = await paymentInfoCollection.insertOne(
          paymentHistory
        );
        res.send({
          success: true,
          modifiedApplication: result,
          paymentInfo: resultPayment,
          transactionId: session.payment_intent,
        });
      }
    });

    // *****  Endpoint for user data *****
    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // ****** loan data *******

    // Endpoint to post loans
    app.post("/loans", async (req, res) => {
      const loan = req.body;
      const result = await loansCollection.insertOne(loan);
      res.send(result);
    });
    // Endpoint to get all loans for all loan page
    app.get("/loans", async (req, res) => {
      const result = await loansCollection.find().toArray();
      res.send(result);
    });
    // Endpoint to get single loan by ID
    app.get("/loans/all-loans/:loanId", async (req, res) => {
      const id = req.params.loanId;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.findOne(query);
      res.send(result);
    });

    // endpoint to get 6 loans for home page
    app.get("/loans/home", async (req, res) => {
      const result = await loansCollection.find().limit(6).toArray();
      res.send(result);
    });
    // endpoint to delete loans from manage loan
    app.delete("/loans/:loanId", async (req, res) => {
      const id = req.params.loanId;
      const query = { _id: new ObjectId(id) };
      const result = await loansCollection.deleteOne(query);
      res.send(result);
    });

    // **** loan application API *******

    // endpoint for loanApplication post
    app.post("/loanApplication", async (req, res) => {
      const applicationData = req.body;
      const result = await applicationCollection.insertOne(applicationData);
      res.send(result);
    });

    // endpoint for get loanApplication for user with email meager with status
    app.get("/loanApplication", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;
      const { status } = req.query;
      const query = {};
      if (email) {
        query.userEmail = email;

        if (email !== req.decodedEmail) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }

      if (email) {
        const query = { userEmail: email };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      }
      if (status === "pending") {
        const query = { status: status };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      }
      if (status === "approved") {
        const query = { status: status };
        const result = await applicationCollection.find(query).toArray();
        res.send(result);
      }
    });

    // Endpoint for manager to update status rejected or approved
    app.patch("/loanApplication/:applicationId", async (req, res) => {
      const id = req.params.applicationId;
      const { currentStatus } = req.body;
      const filter = { _id: new ObjectId(id) };
      if (currentStatus === "approved") {
        const update = {
          $set: { status: "approved", approvedAt: new Date().toLocaleString() },
        };
        const result = await applicationCollection.updateOne(filter, update);
        res.send(result);
      }
      if (currentStatus === "rejected") {
        const update = { $set: { status: "rejected" } };
        const result = await applicationCollection.updateOne(filter, update);
        res.send(result);
      }
      if (currentStatus === "pending") {
        const update = { $set: { status: "pending" } };
        const result = await applicationCollection.updateOne(filter, update);
        res.send(result);
      }
      if (currentStatus === "cancelled") {
        const update = {
          $set: {
            status: "cancelled",
            cancelledAt: new Date().toLocaleString(),
          },
        };
        const result = await applicationCollection.updateOne(filter, update);
        res.send(result);
      }
    });

    // *********** Payment info ************

    app.get("/payment-info", async (req, res) => {
      const transactionId = req.query.transactionId;
      console.log(transactionId);

      const query = { transactionId: transactionId };
      const result = await paymentInfoCollection.findOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (err) {
    console.error(err);
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
