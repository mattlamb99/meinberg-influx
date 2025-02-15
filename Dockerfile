# Use an official Node runtime as a parent image
FROM node:14-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install --production

# Copy the rest of the application code
COPY . .

# (Optional) Expose a port if you add a web server later; otherwise, this line can be omitted
EXPOSE 3000

# Start the application
CMD [ "npm", "start" ]
