// Единая точка загрузки окружения: корневой .env репозитория.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
