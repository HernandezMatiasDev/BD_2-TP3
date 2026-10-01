use red_social_tp3;

db.publicaciones.updateOne(
  { _id:  ObjectId('6abd63f329d70067564c78cc') }, 
  { $pull: { hashtags: "POO" } }
);