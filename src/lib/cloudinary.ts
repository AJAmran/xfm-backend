import { v2 as Cloudinary } from "cloudinary";
import env from "../config/env";


Cloudinary.config({
	cloud_name: env.cloudinary_cloud_name,
	api_key: env.cloudinary_api_key,
	api_secret: env.cloudinary_api_secret,
});

export const cloudinary = Cloudinary;