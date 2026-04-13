'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function PricingPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleBetaAccess = async () => {
    setIsLoading(true);
    // TODO: Implement beta access request logic
    setTimeout(() => {
      alert('Beta access request submitted! We\'ll be in touch soon.');
      setIsLoading(false);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white dark:from-black dark:to-zinc-900 py-20 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold text-black dark:text-zinc-50 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            Select the perfect plan for your SAT preparation journey
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Starter Plan - POPPING */}
          <Card className="relative border-2 border-indigo-500 shadow-2xl transform scale-105 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950 dark:to-zinc-900">
            {/* Popular Badge */}
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-indigo-600 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
                MOST POPULAR
              </span>
            </div>
            
            <CardHeader className="text-center pt-8">
              <CardTitle className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                Starter
              </CardTitle>
              <div className="mt-4">
                <span className="text-4xl font-bold text-black dark:text-zinc-50">$29</span>
                <span className="text-zinc-600 dark:text-zinc-400">/month</span>
              </div>
              <CardDescription className="mt-2 text-zinc-600 dark:text-zinc-400">
                Perfect for getting started
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">20 practice questions daily</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Basic progress tracking</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Access to study materials</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Email support</span>
                </li>
              </ul>
            </CardContent>
            
            <CardFooter>
              <Button 
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-6 text-lg shadow-lg hover:shadow-xl transition-all"
                size="lg"
              >
                Get Started
              </Button>
            </CardFooter>
          </Card>

          {/* Pro Plan */}
          <Card className="border border-zinc-200 dark:border-zinc-800">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-bold text-black dark:text-zinc-50">
                Pro
              </CardTitle>
              <div className="mt-4">
                <span className="text-4xl font-bold text-black dark:text-zinc-50">$59</span>
                <span className="text-zinc-600 dark:text-zinc-400">/month</span>
              </div>
              <CardDescription className="mt-2 text-zinc-600 dark:text-zinc-400">
                For serious learners
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Unlimited practice questions</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Advanced analytics</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Personalized study plans</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Priority support</span>
                </li>
              </ul>
            </CardContent>
            
            <CardFooter>
              <Button 
                className="w-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:hover:bg-zinc-100 dark:text-black text-white font-semibold py-6 text-lg"
                size="lg"
                variant="outline"
              >
                Upgrade to Pro
              </Button>
            </CardFooter>
          </Card>

          {/* Enterprise Plan */}
          <Card className="border border-zinc-200 dark:border-zinc-800">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-bold text-black dark:text-zinc-50">
                Enterprise
              </CardTitle>
              <div className="mt-4">
                <span className="text-4xl font-bold text-black dark:text-zinc-50">Custom</span>
              </div>
              <CardDescription className="mt-2 text-zinc-600 dark:text-zinc-400">
                For schools and institutions
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <ul className="space-y-3">
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Everything in Pro</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Custom integrations</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">Dedicated account manager</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-600 dark:text-green-400">✓</span>
                  <span className="text-zinc-700 dark:text-zinc-300">24/7 support</span>
                </li>
              </ul>
            </CardContent>
            
            <CardFooter>
              <Button 
                className="w-full bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-50 dark:hover:bg-zinc-100 dark:text-black text-white font-semibold py-6 text-lg"
                size="lg"
                variant="outline"
              >
                Contact Sales
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Beta Access Section */}
        <div className="mt-20 text-center">
          <div className="max-w-2xl mx-auto bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-8 shadow-2xl">
            <h2 className="text-3xl font-bold text-white mb-4">
              Want Early Access?
            </h2>
            <p className="text-purple-100 mb-6 text-lg">
              Join our beta program and get exclusive access to new features before everyone else!
            </p>
            <Button
              onClick={handleBetaAccess}
              disabled={isLoading}
              className="bg-white text-purple-600 hover:bg-purple-50 font-bold text-lg px-8 py-6 shadow-xl hover:shadow-2xl transition-all transform hover:scale-105"
              size="lg"
            >
              {isLoading ? 'Submitting...' : '🚀 Request Beta Access'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
