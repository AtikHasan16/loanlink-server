const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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

const verifyFirebaseToken = (req, res, next) => {
  // Get the token from the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];

  // Verify the token using Firebase Admin SDK
};

app.get("/", (req, res) => {
  res.send("Server is running");
});

const database = client.db("LoanLink");
const loansCollection = database.collection("loans");
const applicationCollection = database.collection("applications");
// MongoDB connection
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

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

    // **** loan application API *******

    // endpoint for loanApplication post
    app.post("/loanApplication", async (req, res) => {
      const applicationData = req.body;
      const result = await applicationCollection.insertOne(applicationData);
      res.send(result);
    });

    // endpoint for get loanApplication for user with email meager with status
    app.get("/loanApplication", async (req, res) => {
      const { email } = req.query;
      const { status } = req.query;

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
