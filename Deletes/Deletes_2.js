use red_social_tp3;

db.publicaciones.deleteMany({
  likes: { $lt: 5 },
  $expr: {
    $lt: [
      "$fecha", 
      {
        $dateSubtract: {
          startDate: "$$NOW",
          unit: "year",
          amount: 1
        }
      }
    ]
  }
});